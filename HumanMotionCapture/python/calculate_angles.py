import numpy as np

def get_angle(a, b, c):
    """
    Tính góc tại điểm b, tạo bởi 3 điểm a-b-c.
    Dùng arctan2 để tính chính xác.
    Trả về góc theo độ 0-180.
    Chỉ dùng tọa độ x, y (bỏ qua z vì xử lý trên ảnh tĩnh 2D).
    """
    a_x, a_y = a['x'], a['y']
    b_x, b_y = b['x'], b['y']
    c_x, c_y = c['x'], c['y']

    # Sử dụng hàm np.arctan2 (tính toán radian)
    radians = np.arctan2(c_y - b_y, c_x - b_x) - np.arctan2(a_y - b_y, a_x - b_x)
    angle = np.abs(radians * 180.0 / np.pi)

    # Đưa góc về dải từ 0 đến 180 độ
    if angle > 180.0:
        angle = 360.0 - angle

    return round(angle, 1)

def calculate_angles(landmarks):
    """
    Input: list 33 landmarks từ detect_skeleton()
    Output: dict các góc khớp
    """
    if not landmarks or len(landmarks) < 33:
        return {}

    # --- Trích xuất các điểm dựa theo ID chuẩn của MediaPipe ---
    nose = landmarks[0]
    
    l_shoulder = landmarks[11]
    r_shoulder = landmarks[12]
    
    l_elbow = landmarks[13]
    r_elbow = landmarks[14]
    
    l_wrist = landmarks[15]
    r_wrist = landmarks[16]
    
    l_hip = landmarks[23]
    r_hip = landmarks[24]
    
    l_knee = landmarks[25]
    r_knee = landmarks[26]
    
    l_ankle = landmarks[27]
    r_ankle = landmarks[28]

    # --- Tính toán các góc cơ bản ---
    angles = {
        "left_knee": get_angle(l_hip, l_knee, l_ankle),
        "right_knee": get_angle(r_hip, r_knee, r_ankle),
        
        "left_hip": get_angle(l_shoulder, l_hip, l_knee),
        "right_hip": get_angle(r_shoulder, r_hip, r_knee),
        
        "left_elbow": get_angle(l_shoulder, l_elbow, l_wrist),
        "right_elbow": get_angle(r_shoulder, r_elbow, r_wrist),
        
        "left_shoulder": get_angle(l_elbow, l_shoulder, l_hip),
        "right_shoulder": get_angle(r_elbow, r_shoulder, r_hip)
    }

    # --- Tính góc nghiêng thân người (torso_lean) ---
    # Lấy trung điểm của hai vai và hai hông
    mid_shoulder = {
        "x": (l_shoulder['x'] + r_shoulder['x']) / 2.0,
        "y": (l_shoulder['y'] + r_shoulder['y']) / 2.0
    }
    mid_hip = {
        "x": (l_hip['x'] + r_hip['x']) / 2.0,
        "y": (l_hip['y'] + r_hip['y']) / 2.0
    }
    
    # Tạo một điểm giả lập "thẳng đứng hướng lên" từ hông (do trục y trong ảnh chiều dương đi xuống)
    vertical_pt_hip = {
        "x": mid_hip['x'],
        "y": mid_hip['y'] - 1.0  
    }
    # Góc giữa trục thẳng đứng, hông, và vai
    angles["torso_lean"] = get_angle(vertical_pt_hip, mid_hip, mid_shoulder)

    # --- Tính góc cổ/cúi đầu (neck_angle) ---
    # Dùng trục thẳng đứng từ vai chiếu lên
    vertical_pt_shoulder = {
        "x": mid_shoulder['x'],
        "y": mid_shoulder['y'] - 1.0
    }
    # Góc giữa trục thẳng đứng, vai, và mũi
    angles["neck_angle"] = get_angle(vertical_pt_shoulder, mid_shoulder, nose)

    return angles
