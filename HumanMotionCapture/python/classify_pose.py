def get_match_score(val, min_v, max_v, tol=25):
    """
    Hàm phụ: Tính điểm số % khớp của giá trị `val` so với khoảng `[min_v, max_v]`.
    Nếu nằm trong khoảng => 100%.
    Nếu lệch ra ngoài nhưng nằm trong khoảng dung sai (tol) => giảm dần về 0.
    """
    if min_v <= val <= max_v:
        return 100
    
    # Tính khoảng cách bị lệch
    diff = min(abs(min_v - val), abs(max_v - val))
    
    # Trừ điểm dần
    score = 100 - (diff / tol) * 100
    return max(0, int(score))

def classify_pose(angles):
    """
    Input: dict angles từ calculate_angles()
    Output: dict chứa kết quả phân loại tư thế và độ tự tin (confidence)
    """
    if not angles:
        return {
            "label": "KHÔNG XÁC ĐỊNH",
            "confidence": 0,
            "reason": "Không có dữ liệu góc đầu vào.",
            "all_scores": {}
        }

    # Lấy các góc cơ bản
    l_k = angles.get('left_knee', 0)
    r_k = angles.get('right_knee', 0)
    l_h = angles.get('left_hip', 0)
    r_h = angles.get('right_hip', 0)
    tl = angles.get('torso_lean', 0)

    scores = {}

    # 1. ĐỨNG THẲNG
    # Điều kiện: left_knee > 160, right_knee > 160, left_hip > 150, right_hip > 150, torso_lean < 20
    scores["ĐỨNG THẲNG"] = int((
        get_match_score(l_k, 160, 180) +
        get_match_score(r_k, 160, 180) +
        get_match_score(l_h, 150, 180) +
        get_match_score(r_h, 150, 180) +
        get_match_score(tl, 0, 20)
    ) / 5)

    # 2. ĐỨNG NGHIÊNG
    # Điều kiện: left_knee > 160, right_knee > 160, torso_lean 20-45
    scores["ĐỨNG NGHIÊNG"] = int((
        get_match_score(l_k, 160, 180) +
        get_match_score(r_k, 160, 180) +
        get_match_score(tl, 20, 45)
    ) / 3)

    # 3. NGỒI
    # Điều kiện: knee 70-120, hip 80-120
    scores["NGỒI"] = int((
        get_match_score(l_k, 70, 120) +
        get_match_score(r_k, 70, 120) +
        get_match_score(l_h, 80, 120) +
        get_match_score(r_h, 80, 120)
    ) / 4)

    # 4. NGỒI XỔM
    # Điều kiện: knee 30-70, hip 30-80, torso_lean 25-60 (trọng tâm chúi tới trước để giữ thăng bằng)
    scores["NGỒI XỔM"] = int((
        get_match_score(l_k, 30, 70) +
        get_match_score(r_k, 30, 70) +
        get_match_score(l_h, 30, 80) +
        get_match_score(r_h, 30, 80) +
        get_match_score(tl, 25, 60)
    ) / 5)

    # 4.5. NGỒI BỆT (Ngồi sát đất, co gối)
    # Điều kiện: knee 30-80, hip 30-80, torso_lean 0-25 (thân người thẳng hoặc hơi ngả ra sau)
    scores["NGỒI BỆT"] = int((
        get_match_score(l_k, 30, 80) +
        get_match_score(r_k, 30, 80) +
        get_match_score(l_h, 30, 80) +
        get_match_score(r_h, 30, 80) +
        get_match_score(tl, 0, 25)
    ) / 5)

    # 5. CÚI NGƯỜI
    # Điều kiện: torso_lean > 45, left_knee > 140
    scores["CÚI NGƯỜI"] = int((
        get_match_score(tl, 45, 180) +
        get_match_score(l_k, 140, 180)
    ) / 2)

    # Phân tích tìm nhãn có điểm cao nhất
    best_label = max(scores, key=scores.get)
    best_score = scores[best_label]

    avg_knee = round((l_k + r_k) / 2, 1)
    avg_hip = round((l_h + r_h) / 2, 1)

    # Nếu không có nhãn nào đạt ít nhất 50% độ tự tin
    if best_score < 50:
        final_label = "KHÔNG XÁC ĐỊNH"
        reason = f"Không khớp rõ tư thế nào. Giống '{best_label}' nhất ({best_score}%) với knee_angle~{avg_knee}°, hip_angle~{avg_hip}°, torso_lean={tl}°."
    else:
        final_label = best_label
        reason = f"Phân loại {final_label} vì knee_angle~{avg_knee}°, hip_angle~{avg_hip}°, torso_lean={tl}°"

    return {
        "label": final_label,
        "confidence": best_score,
        "reason": reason,
        "all_scores": scores
    }
