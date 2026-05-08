// viewer.js — Fixed: áp pose đúng sau khi GLB load xong
let scene, camera, renderer, controls;
let characterModel = null;
let isInit = false;
let pendingPoseData = null; // Lưu pose tạm nếu model chưa load xong
let restQuaternions = {}; // Lưu T-Pose ban đầu của xương
// =============================================
// NORMALIZE TÊN XƯƠNG
// Three.js GLTFLoader thường strip dấu ":" khỏi tên node
// VD: "mixamorig1:Hips" → "mixamorig1Hips"
// =============================================
function normalizeBoneName(name) {
    // Bỏ dấu ":" và lấy phần sau prefix (nếu có)
    return name.replace(/:/g, '').toLowerCase();
}

// Xây dựng map từ tên chuẩn hóa → object thực tế trong scene
function buildBoneMap(model) {
    let map = {};
    model.traverse(function (obj) {
        if (obj.name && obj.name !== '') {
            // Key: tên gốc (lowercase, bỏ dấu ':')
            let key = normalizeBoneName(obj.name);
            map[key] = obj;
        }
    });
    return map;
}

// =============================================
// HÀM ÁP POSE — Vector Tracking Kinematics
// =============================================
const BONE_ORDER = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm',
    'RightShoulder', 'RightArm', 'RightForeArm',
    'LeftUpLeg', 'LeftLeg',
    'RightUpLeg', 'RightLeg'
];

function applyBones(poseData) {
    if (!poseData || !poseData.bones || !characterModel) {
        console.warn('⚠️ applyBones: thiếu poseData hoặc model chưa load');
        return;
    }

    let appliedCount = 0;
    let boneMap = buildBoneMap(characterModel);

    // 1. Phục hồi toàn bộ về T-Pose
    characterModel.traverse(function (obj) {
        if (restQuaternions[obj.name]) {
            obj.quaternion.copy(restQuaternions[obj.name]);
        }
    });
    characterModel.updateMatrixWorld(true);

    // 2. Xử lý theo thứ tự phân cấp (Cha -> Con)
    BONE_ORDER.forEach(shortName => {
        let boneName = "mixamorig1:" + shortName;
        let data = poseData.bones[boneName];
        if (!data || !data.target_vec) return;

        let normalizedKey = normalizeBoneName(boneName);
        let found = boneMap[normalizedKey];
        if (!found) return;

        // Tìm xương con trực tiếp để làm vector hướng (chọn child đầu tiên là bone)
        let childBone = null;
        for (let i = 0; i < found.children.length; i++) {
            if (found.children[i].type === 'Bone' || found.children[i].isBone) {
                childBone = found.children[i];
                break;
            }
        }

        if (childBone) {
            // Cập nhật ma trận vì các parent đã bị xoay
            characterModel.updateMatrixWorld(true);

            let posParent = new THREE.Vector3();
            found.getWorldPosition(posParent);

            let posChild = new THREE.Vector3();
            childBone.getWorldPosition(posChild);

            let v_current = new THREE.Vector3().subVectors(posChild, posParent).normalize();

            // Vector mục tiêu từ Python
            let v_target = new THREE.Vector3(data.target_vec.x, data.target_vec.y, data.target_vec.z).normalize();

            // Tính quaternion quay từ v_current sang v_target
            let q_world = new THREE.Quaternion().setFromUnitVectors(v_current, v_target);

            // LocalQuat = ParentWorldQuat^-1 * (q_world * OldWorldQuat)
            let oldWorldQuat = new THREE.Quaternion();
            found.getWorldQuaternion(oldWorldQuat);

            let newWorldQuat = q_world.multiply(oldWorldQuat);

            let parentWorldQuat = new THREE.Quaternion();
            if (found.parent) {
                found.parent.getWorldQuaternion(parentWorldQuat);
            }

            found.quaternion.copy(parentWorldQuat.invert().multiply(newWorldQuat));
            appliedCount++;
        }
    });

    // 3. Cập nhật trạng thái hiển thị
    let statusEl = document.getElementById('three-status');
    if (statusEl) {
        if (appliedCount > 0) {
            statusEl.innerHTML = 'Đã đồng bộ ' + appliedCount + ' khớp xương';
            statusEl.style.color = '#739E82'; // Sage green
        } else {
            statusEl.innerHTML = 'Không thể đồng bộ khớp xương';
            statusEl.style.color = '#C87979'; // Muted rose
        }
    }
}

// =============================================
// KHỞI TẠO SCENE
// =============================================
function initViewer(containerId, poseData) {
    let container = document.getElementById(containerId);
    if (!container) {
        console.error('❌ Không tìm thấy container:', containerId);
        return;
    }

    // Lưu poseData để áp sau khi model load xong
    pendingPoseData = poseData;

    if (!isInit) {
        let w = container.clientWidth || 500;
        let h = container.clientHeight || 350;

        // Setup scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xFFFBF2); // Pastel yellow base

        // Camera
        camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.set(0, 1.2, 3.5);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;

        // Xóa nội dung cũ và thêm canvas
        container.innerHTML = '';
        container.style.position = 'relative';

        // Status label
        let statusDiv = document.createElement('div');
        statusDiv.id = 'three-status';
        statusDiv.style.cssText = 'position:absolute;top:12px;left:16px;font-size:0.85rem;color:#7A766C;z-index:10;background:rgba(255,255,255,0.8);padding:6px 12px;border-radius:6px;border:1px solid #E8E3D5;backdrop-filter:blur(4px);font-family:"Outfit",sans-serif;';
        statusDiv.innerText = 'Đang tải mô hình 3D...';
        container.appendChild(statusDiv);
        container.appendChild(renderer.domElement);

        // Ánh sáng
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        let dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(3, 8, 5);
        dirLight.castShadow = true;
        scene.add(dirLight);
        let backLight = new THREE.DirectionalLight(0xFFEBB8, 0.4); // Warm light
        backLight.position.set(-3, 3, -5);
        scene.add(backLight);

        // Sàn lưới
        let grid = new THREE.GridHelper(6, 12, 0xE8E3D5, 0xF5F0E1);
        scene.add(grid);

        // Controls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.target.set(0, 0.9, 0);
        controls.autoRotate = false;

        // Resize handler
        window.addEventListener('resize', function () {
            if (!renderer || !container) return;
            let newW = container.clientWidth;
            let newH = container.clientHeight;
            camera.aspect = newW / newH;
            camera.updateProjectionMatrix();
            renderer.setSize(newW, newH);
        });

        // =============================================
        // LOAD GLB — Áp pose SAU KHI load xong
        // =============================================
        let loader = new THREE.GLTFLoader();
        loader.load(
            '/static/models/character.glb',

            // ✅ onLoad callback
            function (gltf) {
                characterModel = gltf.scene;

                // Đồng thời lưu lại Quaternion gốc (T-Pose) của toàn bộ object/bone
                characterModel.traverse(function (child) {
                    restQuaternions[child.name] = child.quaternion.clone();

                    if (child.isSkinnedMesh) {
                        child.frustumCulled = false;
                    }
                    
                    // Khắc phục lỗi vật liệu (với một số mô hình bị trong suốt/lỗi Z-fighting)
                    if (child.isMesh && child.material) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        
                        let mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(mat => {
                            // Ép buộc ghi depth để các bộ phận không bị đè ngược lên nhau
                            mat.depthWrite = true;
                            // Nếu model bị trong suốt mờ mờ toàn thân, ta tắt transparent đi
                            // và bật alphaTest để giữ lại các viền cắt (như tóc, lông mi)
                            if (mat.transparent) {
                                mat.transparent = false;
                                mat.alphaTest = 0.5;
                            }
                        });
                    }
                });

                // Căn giữa model
                let box = new THREE.Box3().setFromObject(characterModel);
                let center = box.getCenter(new THREE.Vector3());
                characterModel.position.set(-center.x, -box.min.y, -center.z);

                scene.add(characterModel);
                document.getElementById('three-status').innerText = 'Mô hình đã sẵn sàng';

                // ⭐ QUAN TRỌNG: Áp pose NGAY SAU KHI model load xong
                if (pendingPoseData) {
                    console.log('Model tải xong — áp dụng dữ liệu mô phỏng...');
                    // Delay nhỏ để Three.js kịp setup skeleton
                    setTimeout(function () {
                        applyBones(pendingPoseData);
                    }, 100);
                } else {
                    // Demo test: giơ tay trái lên để kiểm tra bones hoạt động
                    setTimeout(function () {
                        let testBone = null;
                        characterModel.traverse(function (obj) {
                            if (obj.name && obj.name.toLowerCase().includes('leftarm') && !obj.name.toLowerCase().includes('fore')) {
                                testBone = obj;
                            }
                        });
                        if (testBone) {
                            testBone.rotation.z = -1.0;
                            console.log('Kiểm tra xương:', testBone.name);
                        }
                    }, 100);
                }
            },

            // onProgress callback
            function (xhr) {
                if (xhr.total > 0) {
                    let pct = Math.round((xhr.loaded / xhr.total) * 100);
                    let statusEl = document.getElementById('three-status');
                    if (statusEl) statusEl.innerText = 'Đang tải model: ' + pct + '%';
                }
            },

            // onError callback
            function (err) {
                console.error('Lỗi tải tệp GLB:', err);
                let statusEl = document.getElementById('three-status');
                if (statusEl) {
                    statusEl.innerText = 'Không thể tải mô hình character.glb';
                    statusEl.style.color = '#C87979';
                }
            }
        );

        isInit = true;
        animate();

    } else {
        // Scene đã init rồi — chỉ áp pose mới
        if (characterModel) {
            console.log('Đang cập nhật mô phỏng...');
            applyBones(poseData);
        } else {
            console.warn('Mô hình chưa tải xong, đang lưu trữ tạm thời...');
            pendingPoseData = poseData;
        }
    }
}

// =============================================
// ANIMATION LOOP
// =============================================
function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

// =============================================
// HÀM ĐƯỢC GỌI TỪ index.html
// =============================================
window.updateThreeJSPose = function (poseData, landmarks) {
    console.log('📡 updateThreeJSPose được gọi');
    console.log('📦 poseData nhận được:', JSON.stringify(poseData, null, 2));
    initViewer('three-canvas-container', poseData);
};