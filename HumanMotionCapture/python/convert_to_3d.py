import math

# PREFIX xương thực tế trong model
PREFIX = "mixamorig1:"

def convert_to_3d(landmarks):
    if not landmarks or len(landmarks) < 33:
        return {"bones": {}}

    # Tọa độ MediaPipe:
    # X: trái sang phải (0 -> 1)
    # Y: trên xuống dưới (0 -> 1)
    # Z: xa đến gần (âm = gần camera)
    
    def get_vec(p1, p2):
        # Hệ tọa độ Three.js:
        # X: phải. Y: LÊN. Z: LÙI LẠI (âm là ra xa camera)
        # MediaPipe Y hướng xuống -> Cần đảo ngược Y
        # MediaPipe Z âm là GẦN camera -> ThreeJS Z âm là XA camera -> Cần đảo Z
        dx = p2['x'] - p1['x']
        dy = -(p2['y'] - p1['y'])
        # Giảm nhiễu Z đi 50% để tránh xương lật do chiều sâu ảo của AI
        dz = -(p2['z'] - p1['z']) * 0.5 
        
        length = math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001
        return {"x": dx/length, "y": dy/length, "z": dz/length}

    nose = landmarks[0]
    l_sh = landmarks[11]
    r_sh = landmarks[12]
    l_el = landmarks[13]
    r_el = landmarks[14]
    l_wr = landmarks[15]
    r_wr = landmarks[16]
    l_hip = landmarks[23]
    r_hip = landmarks[24]
    l_knee = landmarks[25]
    r_knee = landmarks[26]
    l_ank = landmarks[27]
    r_ank = landmarks[28]

    mid_sh = {'x': (l_sh['x']+r_sh['x'])/2, 'y': (l_sh['y']+r_sh['y'])/2, 'z': (l_sh['z']+r_sh['z'])/2}
    mid_hip = {'x': (l_hip['x']+r_hip['x'])/2, 'y': (l_hip['y']+r_hip['y'])/2, 'z': (l_hip['z']+r_hip['z'])/2}

    # Tracking bằng World Vector (Hệ thống này miễn nhiễm với lỗi sai trục Local Axis của Mixamo)
    bones = {
        f"{PREFIX}Spine": {"target_vec": get_vec(mid_hip, mid_sh)},
        f"{PREFIX}Neck": {"target_vec": get_vec(mid_sh, nose)},
        f"{PREFIX}LeftArm": {"target_vec": get_vec(l_sh, l_el)},
        f"{PREFIX}LeftForeArm": {"target_vec": get_vec(l_el, l_wr)},
        f"{PREFIX}RightArm": {"target_vec": get_vec(r_sh, r_el)},
        f"{PREFIX}RightForeArm": {"target_vec": get_vec(r_el, r_wr)},
        f"{PREFIX}LeftUpLeg": {"target_vec": get_vec(l_hip, l_knee)},
        f"{PREFIX}LeftLeg": {"target_vec": get_vec(l_knee, l_ank)},
        f"{PREFIX}RightUpLeg": {"target_vec": get_vec(r_hip, r_knee)},
        f"{PREFIX}RightLeg": {"target_vec": get_vec(r_knee, r_ank)},
    }

    return {"bones": bones}
