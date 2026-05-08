import cv2
import mediapipe as mp
import base64
import numpy as np

# Danh sách 33 điểm khớp (landmarks) của MediaPipe Pose
LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index"
]

def detect_skeleton(image_np):
    """
    Input: ảnh dạng numpy array (BGR từ OpenCV)
    Output: dict gồm success, landmarks, skeleton_image_base64
    """
    mp_pose = mp.solutions.pose
    mp_drawing = mp.solutions.drawing_utils

    results = None
    image_rgb = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)

    # Thử từ model mạnh nhất (2) xuống model nhẹ nhất (0) để đảm bảo tìm thấy người
    for complexity in [2, 1, 0]:
        with mp_pose.Pose(
            static_image_mode=True,
            model_complexity=complexity,
            enable_segmentation=False,
            min_detection_confidence=0.3  # Ngưỡng thấp để nhận diện nhiều ảnh hơn
        ) as pose:
            results = pose.process(image_rgb)
            if results.pose_landmarks:
                break  # Tìm thấy người, thoát vòng lặp

    # Không tìm thấy người trong ảnh
    if not results or not results.pose_landmarks:
        return {
            "success": False,
            "error": "Không tìm thấy người trong ảnh. Hãy dùng ảnh chụp rõ toàn thân người (đầu, vai, tay, chân đều thấy được).",
            "landmarks": [],
            "skeleton_image_base64": ""
        }

    # Tạo bản sao ảnh để vẽ đè lên
    annotated_image = image_np.copy()
    h, w, _ = annotated_image.shape

    landmarks_data = []

    # Extract 33 landmarks và vẽ tên lên ảnh
    for idx, lm in enumerate(results.pose_landmarks.landmark):
        landmarks_data.append({
            "id": idx,
            "name": LANDMARK_NAMES[idx],
            "x": lm.x,
            "y": lm.y,
            "z": lm.z,
            "visibility": lm.visibility
        })

        # Tính tọa độ pixel thực tế
        px, py = int(lm.x * w), int(lm.y * h)

        # Vẽ tên landmark (chỉ vẽ nếu điểm đủ rõ và nằm trong ảnh)
        if 0 <= px < w and 0 <= py < h and lm.visibility > 0.3:
            cv2.putText(
                annotated_image,
                LANDMARK_NAMES[idx],
                (px + 5, py - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.35,
                (255, 255, 0),
                1,
                cv2.LINE_AA
            )

    # Tự động tính toán độ dày nét vẽ dựa trên kích thước ảnh (giải quyết lỗi nét quá mảnh trên ảnh độ phân giải cao)
    h, w, _ = annotated_image.shape
    line_thickness = max(3, int(min(h, w) * 0.006))
    circle_rad = max(4, int(min(h, w) * 0.008))

    # Vẽ khung xương: chấm tròn đỏ (dày) + đường nối xanh lá (dày)
    landmark_drawing_spec = mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=-1, circle_radius=circle_rad)
    connection_drawing_spec = mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=line_thickness)

    mp_drawing.draw_landmarks(
        annotated_image,
        results.pose_landmarks,
        mp_pose.POSE_CONNECTIONS,
        landmark_drawing_spec=landmark_drawing_spec,
        connection_drawing_spec=connection_drawing_spec
    )

    # Chuyển ảnh kết quả sang base64 để trả về web
    success, buffer = cv2.imencode('.jpg', annotated_image)
    if not success:
        return {
            "success": False,
            "error": "Không thể encode ảnh kết quả.",
            "landmarks": [],
            "skeleton_image_base64": ""
        }

    jpg_as_text = base64.b64encode(buffer).decode('utf-8')
    base64_string = f"data:image/jpeg;base64,{jpg_as_text}"

    return {
        "success": True,
        "landmarks": landmarks_data,
        "skeleton_image_base64": base64_string
    }
