import math

# PREFIX xương thực tế trong model
PREFIX = "mixamorig1:"

def convert_to_3d(landmarks, pose_label=""):
    if not landmarks or len(landmarks) < 33:
        return {"bones": {}}

    # Tọa độ MediaPipe:
    # X: trái sang phải (0 -> 1)
    # Y: trên xuống dưới (0 -> 1)
    # Z: xa đến gần (âm = gần camera)

    def get_vec(p1, p2):
        # Hệ tọa độ Three.js: X phải, Y lên, Z ra ngoài
        # MediaPipe Y hướng xuống -> đảo ngược Y
        dx = p2['x'] - p1['x']
        dy = -(p2['y'] - p1['y'])
        dz = -(p2['z'] - p1['z']) * 0.5
        length = math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001
        return {"x": dx/length, "y": dy/length, "z": dz/length}

    def get_vec_arm(p1, p2):
        # MediaPipe depth (Z) cực kỳ nhiễu đối với tay.
        # Giảm trọng số Z về 0.05 giúp tay buông thẳng sát người tự nhiên
        dx = p2['x'] - p1['x']
        dy = -(p2['y'] - p1['y'])
        dz = -(p2['z'] - p1['z']) * 0.05
        length = math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001
        return {"x": dx/length, "y": dy/length, "z": dz/length}

    def get_vec_leg(p1, p2, x_scale=1.0):
        # Chân: scale X theo mức độ chân dang rộng
        # x_scale = 1.0 → giữ nguyên (chân dang rộng)
        # x_scale = 0.3 → giảm nhẹ (chân gần nhau, đứng sát)
        dx = (p2['x'] - p1['x']) * x_scale
        dy = -(p2['y'] - p1['y'])
        dz = -(p2['z'] - p1['z']) * 0.15
        length = math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001
        return {"x": dx/length, "y": dy/length, "z": dz/length}

    def get_vec_spine(p1, p2):
        # Spine chỉ lên trên (Y), loại bỏ Z hoàn toàn
        # Z của MediaPipe thêm cấu hình thân người quá nhỏ sẽ gây coli lean forward
        dx = p2['x'] - p1['x']
        dy = -(p2['y'] - p1['y'])
        # Z = 0 để cột sống luôn đứng thẳng — không coi/ngầng
        length = math.sqrt(dx*dx + dy*dy) + 0.0001
        return {"x": dx/length, "y": dy/length, "z": 0.0}

    nose  = landmarks[0]
    l_sh  = landmarks[11];  r_sh  = landmarks[12]
    l_el  = landmarks[13];  r_el  = landmarks[14]
    l_wr  = landmarks[15];  r_wr  = landmarks[16]
    l_hip = landmarks[23];  r_hip = landmarks[24]
    l_knee= landmarks[25];  r_knee= landmarks[26]
    l_ank = landmarks[27];  r_ank = landmarks[28]

    mid_sh  = {'x': (l_sh['x']+r_sh['x'])/2,   'y': (l_sh['y']+r_sh['y'])/2,   'z': (l_sh['z']+r_sh['z'])/2}
    mid_hip = {'x': (l_hip['x']+r_hip['x'])/2,  'y': (l_hip['y']+r_hip['y'])/2, 'z': (l_hip['z']+r_hip['z'])/2}

    # ── Phát hiện tư thế CÚI NGƯỜI ──────────────────────────────────────
    torso_dy = mid_sh['y'] - mid_hip['y']   # > 0 nghĩa là vai thấp hơn hông trên ảnh
    torso_dx = mid_sh['x'] - mid_hip['x']
    
    is_bowing = (pose_label == "CÚI NGƯỜI") or (torso_dy > -0.05)

    if is_bowing:
        # ── Chế độ CÚI NGƯỜI ──────────────────────────────────────────────
        spine_y = -abs(torso_dy) / (math.sqrt(torso_dy**2 + 0.01))  # hướng xuống
        spine_z = 0.8   # Hướng về phía trước (+Z) tương thích với hướng mặt của model
        spine_x = (mid_sh['x'] - mid_hip['x'])
        spine_len = math.sqrt(spine_x**2 + spine_y**2 + spine_z**2) + 0.0001
        spine_vec = {"x": spine_x/spine_len, "y": spine_y/spine_len, "z": spine_z/spine_len}

        # Cổ hướng xuống và hơi cúi
        neck_y  = -(abs(nose['y'] - mid_sh['y']) + 0.1)
        neck_z  = 0.6
        neck_x  = nose['x'] - mid_sh['x']
        neck_len = math.sqrt(neck_x**2 + neck_y**2 + neck_z**2) + 0.0001
        neck_vec = {"x": neck_x/neck_len, "y": neck_y/neck_len, "z": neck_z/neck_len}

        bones = {
            f"{PREFIX}Hips":         {"target_vec": spine_vec},
            f"{PREFIX}Spine":        {"target_vec": spine_vec},
            f"{PREFIX}Spine1":       {"target_vec": spine_vec},
            f"{PREFIX}Spine2":       {"target_vec": spine_vec},
            f"{PREFIX}Neck":         {"target_vec": neck_vec},
            f"{PREFIX}LeftArm":      {"target_vec": get_vec_arm(l_sh, l_el)},
            f"{PREFIX}LeftForeArm":  {"target_vec": get_vec_arm(l_el, l_wr)},
            f"{PREFIX}RightArm":     {"target_vec": get_vec_arm(r_sh, r_el)},
            f"{PREFIX}RightForeArm":{"target_vec": get_vec_arm(r_el, r_wr)},
            f"{PREFIX}LeftUpLeg":    {"target_vec": get_vec(l_hip, l_knee)},
            f"{PREFIX}LeftLeg":      {"target_vec": get_vec(l_knee, l_ank)},
            f"{PREFIX}RightUpLeg":   {"target_vec": get_vec(r_hip, r_knee)},
            f"{PREFIX}RightLeg":     {"target_vec": get_vec(r_knee, r_ank)},
        }
    else:
        # ── Chế độ bình thường (đứng / ngồi...) ──────────────────────────
        if pose_label == "ĐỨNG THẲNG":
            # Đo khoảng cách ngang giữa 2 mắt cá so với khoảng cách vai
            # để biết chân có dang rộng không
            ankle_spread = abs(l_ank['x'] - r_ank['x'])
            shoulder_width = abs(l_sh['x'] - r_sh['x']) + 0.0001
            spread_ratio = ankle_spread / shoulder_width

            # Nếu chân dang rộng (> 0.6 lần vai) → giữ nguyên X
            # Nếu chân sát nhau (< 0.3 lần vai) → giảm X nhẹ để tránh chụm quá
            if spread_ratio > 0.6:
                x_scale = 1.0   # chân dang rộng: tracking đầy đủ
            elif spread_ratio > 0.35:
                x_scale = 0.6   # chân hơi dang: giảm nhẹ
            else:
                x_scale = 0.3   # chân gần nhau thật sự: giảm vừa

            def leg_vec_func(p1, p2):
                return get_vec_leg(p1, p2, x_scale=x_scale)
        else:
            leg_vec_func = get_vec

        bones = {
            f"{PREFIX}Hips":         {"target_vec": get_vec_spine(mid_hip, mid_sh)},
            f"{PREFIX}Spine":        {"target_vec": get_vec_spine(mid_hip, mid_sh)},
            f"{PREFIX}Spine1":       {"target_vec": get_vec_spine(mid_hip, mid_sh)},
            f"{PREFIX}Spine2":       {"target_vec": get_vec_spine(mid_hip, mid_sh)},
            f"{PREFIX}Neck":         {"target_vec": get_vec_spine(mid_sh, nose)},
            f"{PREFIX}LeftArm":      {"target_vec": get_vec_arm(l_sh, l_el)},
            f"{PREFIX}LeftForeArm":  {"target_vec": get_vec_arm(l_el, l_wr)},
            f"{PREFIX}RightArm":     {"target_vec": get_vec_arm(r_sh, r_el)},
            f"{PREFIX}RightForeArm":{"target_vec": get_vec_arm(r_el, r_wr)},
            f"{PREFIX}LeftUpLeg":    {"target_vec": leg_vec_func(l_hip, l_knee)},
            f"{PREFIX}LeftLeg":      {"target_vec": leg_vec_func(l_knee, l_ank)},
            f"{PREFIX}RightUpLeg":   {"target_vec": leg_vec_func(r_hip, r_knee)},
            f"{PREFIX}RightLeg":     {"target_vec": leg_vec_func(r_knee, r_ank)},
        }

    return {"bones": bones, "is_bowing": is_bowing}
