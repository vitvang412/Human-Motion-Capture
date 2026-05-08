import traceback

# Xử lý import để code chạy đúng dù gọi từ thư mục python/ hay thư mục root (Flask app.py)
try:
    from detect_skeleton import detect_skeleton
    from calculate_angles import calculate_angles
    from classify_pose import classify_pose
    from convert_to_3d import convert_to_3d
except ImportError:
    from python.detect_skeleton import detect_skeleton
    from python.calculate_angles import calculate_angles
    from python.classify_pose import classify_pose
    from python.convert_to_3d import convert_to_3d

def run_full_pipeline(image_np):
    """
    Input: ảnh numpy array từ Flask (đọc bằng cv2)
    Output: dict tổng hợp toàn bộ kết quả để gửi về Frontend.
    """
    try:
        # 1. Trích xuất khung xương và lấy ảnh base64
        detect_result = detect_skeleton(image_np)
        
        # Kiểm tra xem có nhận diện được người không
        if not detect_result.get("success", False):
            return {
                "success": False,
                "error": "Không tìm thấy người trong ảnh hoặc điểm nhận diện quá mờ."
            }

        landmarks = detect_result["landmarks"]
        
        # 2. Tính toán các góc dựa trên tọa độ
        angles = calculate_angles(landmarks)
        
        # 3. Phân loại tư thế (Đứng, Ngồi, Cúi...)
        pose_classification = classify_pose(angles)
        
        # 4. Trích xuất Rotation của xương cho mô hình 3D (Three.js)
        pose_3d = convert_to_3d(landmarks)
        
        # DEBUG: In giá trị xương ra terminal
        print("[DEBUG pose_3d bones]")
        for bone_name, bone_data in pose_3d.get("bones", {}).items():
            r = bone_data.get("rotation", {})
            print(f"  {bone_name}: x={r.get('x',0):.3f}, y={r.get('y',0):.3f}, z={r.get('z',0):.3f}")
        
        # 5. Gộp kết quả
        return {
            "success": True,
            "skeleton_image_base64": detect_result["skeleton_image_base64"],
            "landmarks": landmarks,
            "pose_label": pose_classification.get("label", "KHÔNG XÁC ĐỊNH"),
            "confidence": pose_classification.get("confidence", 0),
            "reason": pose_classification.get("reason", ""),
            "angles": angles,
            "pose_3d": pose_3d
        }
        
    except Exception as e:
        # Bắt toàn bộ lỗi (như lỗi format dữ liệu, chia cho 0, v.v...) để Flask không crash
        error_msg = f"Đã xảy ra lỗi hệ thống trong quá trình pipeline: {str(e)}"
        
        # In chi tiết lỗi (stack trace) ra terminal để DEV dễ dàng sửa lỗi
        print("[PIPELINE ERROR]")
        traceback.print_exc()
        
        return {
            "success": False,
            "error": error_msg
        }
