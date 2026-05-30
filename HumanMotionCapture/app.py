from flask import Flask, render_template, request, jsonify
import cv2
import numpy as np
import json
import os

# Import Pipeline chính từ thư mục python
from python.main import run_full_pipeline

app = Flask(__name__)

@app.route('/bones')
def list_bones():
    """Debug route: Lấy tên tất cả các node trong GLB model"""
    try:
        import struct
        
        glb_path = os.path.join('static', 'models', 'character.glb')
        with open(glb_path, 'rb') as f:
            # Skip 12-byte GLB header
            f.read(12)
            # Read JSON chunk header (8 bytes)
            chunk_length = struct.unpack('<I', f.read(4))[0]
            chunk_type = f.read(4)
            json_data = json.loads(f.read(chunk_length))
        
        nodes = json_data.get('nodes', [])
        node_names = [n.get('name', f'node_{i}') for i, n in enumerate(nodes)]
        
        # Lọc ra các node có vẻ là bone (có tên chứa chữ hoa hoặc có children)
        return jsonify({
            'total_nodes': len(node_names),
            'node_names': node_names
        })
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/debug-viewer')
def debug_viewer():
    """Debug route: Kiểm tra cấu trúc GLB và xem skeleton có hoạt động không"""
    try:
        import struct
        glb_path = os.path.join('static', 'models', 'character.glb')
        with open(glb_path, 'rb') as f:
            f.read(12)
            chunk_length = struct.unpack('<I', f.read(4))[0]
            f.read(4)
            json_data = json.loads(f.read(chunk_length))
        
        # Đếm số lượng skin và mesh
        skins = json_data.get('skins', [])
        meshes = json_data.get('meshes', [])
        nodes = json_data.get('nodes', [])
        
        # Tìm node nào có skin (SkinnedMesh)
        skinned_nodes = [n.get('name','?') for n in nodes if 'skin' in n]
        bone_names = [n.get('name','') for n in nodes if 'skin' not in n and n.get('name','') and n.get('name','') not in ['Armature','Ch29']]
        
        return jsonify({
            'total_skins': len(skins),
            'total_meshes': len(meshes),
            'skinned_mesh_nodes': skinned_nodes,
            'skin_joint_count': len(skins[0].get('joints',[])) if skins else 0,
            'sample_bone_names': bone_names[:10]
        })
    except Exception as e:
        return jsonify({'error': str(e)})


@app.route('/')
def index():
    # Render file giao diện bạn vừa tạo (Giao diện đơn trang - Single Page Application)
    return render_template('index.html')


@app.route('/analyze', methods=['POST'])
def analyze():
    # Bước 1: Nhận file từ Fetch API (index.html) gửi lên
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "Không tìm thấy file ảnh!"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "Bạn chưa chọn ảnh!"}), 400

    try:
        # Bước 2: Đọc file ảnh TRỰC TIẾP TỪ RAM thành Numpy Array (không cần lưu xuống ổ cứng thư mục temp nữa, giúp web chạy cực nhanh)
        filestr = file.read()
        npimg = np.frombuffer(filestr, np.uint8)
        image_np = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

        if image_np is None:
            return jsonify({"success": False, "error": "Định dạng ảnh không hợp lệ hoặc file bị hỏng."}), 400

        # Bước 3: Chuyền Numpy Array vào Pipeline Xử Lý
        result = run_full_pipeline(image_np)
        
        # Bước 4: Trả về kết quả JSON cho JS vẽ lên màn hình
        return jsonify(result)
        
    except Exception as e:
        # Bắt lỗi không mong muốn
        return jsonify({"success": False, "error": f"Lỗi Server: {str(e)}"}), 500

if __name__ == '__main__':
    # Chạy ở Port 5001
    app.run(debug=True, port=5001)
