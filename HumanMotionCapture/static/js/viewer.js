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
    // poseData là full result object: { pose_3d: { bones: {...} }, angles: {...}, pose_label: '...' }
    const bonesData = (poseData.pose_3d || poseData).bones;
    if (!bonesData || !characterModel) {
        console.warn('applyBones: thiếu bonesData hoặc model chưa load');
        return;
    }

    const angles = poseData.angles || {};
    const poseLabel = poseData.pose_label || '';
    const torsoLean = angles.torso_lean || 0;  // độ, 0 = đứng thẳng, ~170 = cúi sâu
    const isBowing = poseLabel.includes('CÚI') || torsoLean > 80;
    const isSquatting = poseLabel.includes('XỔM');

    if (characterModel.userData && characterModel.userData.originalY !== undefined) {
        // Hạ thấp nhân vật nếu đang ngồi xổm
        characterModel.position.y = characterModel.userData.originalY - (isSquatting ? 0.5 : 0);
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

    // ── Xử lý CÚI NGƯỜI bằng world-space quaternion ────────────────────
    if (isBowing) {
        const totalLeanRad = THREE.MathUtils.degToRad(torsoLean);
        const perBoneRad = totalLeanRad / 3;

        // ── Xác định trục lean thực tế từ xương Hips ──────────────────
        // Thay vì dùng world X (sai nếu nhân vật không face +Z/-Z),
        // lấy trục ngang (lateral) từ quaternion của xương Hips.
        // Hips local X-axis trong world space = trục trái-phải thực sự của nhân vật.
        const hipsKey = normalizeBoneName('mixamorig1:Hips');
        const hipsBone = boneMap[hipsKey];
        let leanAxis = new THREE.Vector3(1, 0, 0); // fallback
        if (hipsBone) {
            characterModel.updateMatrixWorld(true);
            const hipsWorldQuat = new THREE.Quaternion();
            hipsBone.getWorldQuaternion(hipsWorldQuat);
            // Local X của Hips = trục ngang của nhân vật trong world space
            leanAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(hipsWorldQuat).normalize();
        }

        const SPINE_BONES = ['Spine', 'Spine1', 'Spine2'];
        SPINE_BONES.forEach(function (shortName, idx) {
            const boneName = 'mixamorig1:' + shortName;
            const normalizedKey = normalizeBoneName(boneName);
            const bone = boneMap[normalizedKey];
            if (!bone) return;

            characterModel.updateMatrixWorld(true);

            // Tìm child bone
            let childBone = null;
            for (let i = 0; i < bone.children.length; i++) {
                if (bone.children[i].type === 'Bone' || bone.children[i].isBone) {
                    childBone = bone.children[i]; break;
                }
            }
            if (!childBone) { appliedCount++; return; }

            // Vector hướng hiện tại (world space)
            let posParent = new THREE.Vector3();
            let posChild = new THREE.Vector3();
            bone.getWorldPosition(posParent);
            childBone.getWorldPosition(posChild);
            let v_current = new THREE.Vector3().subVectors(posChild, posParent).normalize();

            // Xoay quanh trục ngang thực của nhân vật
            // Thử chiều dương trước; nếu Y của spine tăng (sai), đổi sang âm
            let q_lean = new THREE.Quaternion().setFromAxisAngle(leanAxis, perBoneRad);
            let v_test = v_current.clone().applyQuaternion(q_lean);
            if (v_test.y > v_current.y + 0.005) {
                // Cúi sai chiều (Y tăng = ngẩng lên thay vì cúi) → đổi chiều
                q_lean = new THREE.Quaternion().setFromAxisAngle(leanAxis, -perBoneRad);
            }

            // Áp dụng world rotation → chuyển về local space
            let oldWorldQuat = new THREE.Quaternion();
            bone.getWorldQuaternion(oldWorldQuat);
            let newWorldQuat = q_lean.clone().multiply(oldWorldQuat);
            let parentWorldQuat = new THREE.Quaternion();
            if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
            let localQuat = parentWorldQuat.clone().invert().multiply(newWorldQuat);
            let restQuat = restQuaternions[bone.name];
            if (restQuat) bone.quaternion.slerpQuaternions(restQuat, localQuat, 0.95);
            else bone.quaternion.copy(localQuat);
            bone.updateMatrix();
            appliedCount++;
        });

        // Cổ: cúi nhẹ theo cùng trục
        const neckKey = normalizeBoneName('mixamorig1:Neck');
        const neckBone = boneMap[neckKey];
        if (neckBone) {
            characterModel.updateMatrixWorld(true);
            const neckLeanRad = THREE.MathUtils.degToRad(Math.min(torsoLean * 0.25, 35));
            let q_neck = new THREE.Quaternion().setFromAxisAngle(leanAxis, perBoneRad > 0 ? neckLeanRad : -neckLeanRad);
            let posNeck = new THREE.Vector3(); neckBone.getWorldPosition(posNeck);
            let neckV = new THREE.Vector3(0, 1, 0);
            let neckTest = neckV.clone().applyQuaternion(q_neck);
            if (neckTest.y > neckV.y + 0.005) {
                q_neck = new THREE.Quaternion().setFromAxisAngle(leanAxis, -neckLeanRad);
            }
            let oldNeckWorldQuat = new THREE.Quaternion();
            neckBone.getWorldQuaternion(oldNeckWorldQuat);
            let newNeckWorldQuat = q_neck.clone().multiply(oldNeckWorldQuat);
            let neckParentWorldQuat = new THREE.Quaternion();
            if (neckBone.parent) neckBone.parent.getWorldQuaternion(neckParentWorldQuat);
            let neckLocalQuat = neckParentWorldQuat.clone().invert().multiply(newNeckWorldQuat);
            let neckRestQuat = restQuaternions[neckBone.name];
            if (neckRestQuat) neckBone.quaternion.slerpQuaternions(neckRestQuat, neckLocalQuat, 0.85);
            else neckBone.quaternion.copy(neckLocalQuat);
            neckBone.updateMatrix();
            appliedCount++;
        }

        // Xử lý tay và chân qua vector tracking như cũ
        const LIMB_BONES = [
            'LeftArm', 'LeftForeArm',
            'RightArm', 'RightForeArm',
            'LeftUpLeg', 'LeftLeg',
            'RightUpLeg', 'RightLeg'
        ];
        characterModel.updateMatrixWorld(true);
        LIMB_BONES.forEach(function (shortName) {
            const boneName = 'mixamorig1:' + shortName;
            const data = bonesData[boneName];
            if (!data || !data.target_vec) return;
            const normalizedKey = normalizeBoneName(boneName);
            const found = boneMap[normalizedKey];
            if (!found) return;
            let childBone = null;
            for (let i = 0; i < found.children.length; i++) {
                if (found.children[i].type === 'Bone' || found.children[i].isBone) {
                    childBone = found.children[i]; break;
                }
            }
            if (!childBone) return;
            characterModel.updateMatrixWorld(true);
            let posParent = new THREE.Vector3();
            let posChild = new THREE.Vector3();
            found.getWorldPosition(posParent);
            childBone.getWorldPosition(posChild);
            let v_current = new THREE.Vector3().subVectors(posChild, posParent).normalize();
            let v_target = new THREE.Vector3(data.target_vec.x, data.target_vec.y, data.target_vec.z).normalize();
            let dot = THREE.MathUtils.clamp(v_current.dot(v_target), -1, 1);
            let angleDiff = Math.acos(dot);
            if (angleDiff < 0.01) { appliedCount++; return; }
            if (dot < -0.999) { appliedCount++; return; }  // skip anti-parallel
            let q_world = new THREE.Quaternion().setFromUnitVectors(v_current, v_target);
            let oldWorldQuat = new THREE.Quaternion();
            found.getWorldQuaternion(oldWorldQuat);
            let newWorldQuat = q_world.clone().multiply(oldWorldQuat);
            let parentWorldQuat = new THREE.Quaternion();
            if (found.parent) found.parent.getWorldQuaternion(parentWorldQuat);
            let localQuat = parentWorldQuat.clone().invert().multiply(newWorldQuat);
            let restQuat = restQuaternions[found.name];
            if (restQuat) found.quaternion.slerpQuaternions(restQuat, localQuat, 0.90);
            else found.quaternion.copy(localQuat);
            appliedCount++;
        });

    } else {
        // ── Chế độ bình thường: Vector Tracking ────────────────────────
        BONE_ORDER.forEach(shortName => {
            let boneName = "mixamorig1:" + shortName;
            let data = bonesData[boneName];
            if (!data || !data.target_vec) return;

            let normalizedKey = normalizeBoneName(boneName);
            let found = boneMap[normalizedKey];
            if (!found) return;

            // Bỏ qua Hips (root bone)
            if (shortName === 'Hips') { appliedCount++; return; }
            // Giữ Head + Shoulder trong T-Pose
            // Vai KHÔNG được xoay: nếu xoay Shoulder trước khi xoay Arm,
            // world-position của Arm sẽ sai → tay bị lệch hoàn toàn
            if (shortName === 'Head' || shortName === 'LeftShoulder' || shortName === 'RightShoulder') {
                if (restQuaternions[found.name]) found.quaternion.copy(restQuaternions[found.name]);
                appliedCount++; return;
            }

            let childBone = null;
            for (let i = 0; i < found.children.length; i++) {
                if (found.children[i].type === 'Bone' || found.children[i].isBone) {
                    childBone = found.children[i]; break;
                }
            }
            if (!childBone) return;

            characterModel.updateMatrixWorld(true);
            let posParent = new THREE.Vector3();
            let posChild = new THREE.Vector3();
            found.getWorldPosition(posParent);
            childBone.getWorldPosition(posChild);
            let v_current = new THREE.Vector3().subVectors(posChild, posParent).normalize();
            let v_target = new THREE.Vector3(data.target_vec.x, data.target_vec.y, data.target_vec.z).normalize();
            let dot = THREE.MathUtils.clamp(v_current.dot(v_target), -1, 1);
            let angleDiff = Math.acos(dot);
            if (angleDiff < 0.01) { appliedCount++; return; }
            if (dot < -0.999) { appliedCount++; return; }  // skip anti-parallel

            const MAX_ANGLE = {
                'LeftArm': Math.PI * 0.95,
                'RightArm': Math.PI * 0.95,
                'LeftForeArm': Math.PI * 0.90,
                'RightForeArm': Math.PI * 0.90,
                'LeftShoulder': Math.PI * 0.55,
                'RightShoulder': Math.PI * 0.55,
                'Spine': Math.PI * 0.95,
                'Spine1': Math.PI * 0.95,
                'Spine2': Math.PI * 0.95,
                'LeftUpLeg': Math.PI * 0.90,
                'RightUpLeg': Math.PI * 0.90,
                'LeftLeg': Math.PI * 0.85,
                'RightLeg': Math.PI * 0.85,
            };
            let maxAngle = MAX_ANGLE[shortName] || Math.PI;
            let effectiveVec = v_target;
            if (angleDiff > maxAngle) {
                let t = maxAngle / angleDiff;
                effectiveVec = v_current.clone().lerp(v_target, t).normalize();
            }
            let q_world = new THREE.Quaternion().setFromUnitVectors(v_current, effectiveVec);
            let oldWorldQuat = new THREE.Quaternion();
            found.getWorldQuaternion(oldWorldQuat);
            let newWorldQuat = q_world.clone().multiply(oldWorldQuat);
            let parentWorldQuat = new THREE.Quaternion();
            if (found.parent) found.parent.getWorldQuaternion(parentWorldQuat);
            let localQuat = parentWorldQuat.clone().invert().multiply(newWorldQuat);
            let restQuat = restQuaternions[found.name];
            // Tay: gán trực tiếp localQuat, không slerp từ T-pose
            // Slerp từ T-pose sẽ kéo tay dang ngang → gán thẳng 100% target
            const IS_ARM = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'].includes(shortName);
            if (IS_ARM) {
                found.quaternion.copy(localQuat);
            } else if (restQuat) {
                found.quaternion.slerpQuaternions(restQuat, localQuat, 0.90);
            } else {
                found.quaternion.copy(localQuat);
            }
            appliedCount++;
        });
    }

    // ── Tự động điều chỉnh camera góc nhìn theo tư thế ──
    if (camera && controls) {
        if (isBowing) {
            // Nhân vật cúi về phía +Z → camera ở +Z để thấy mặt/đầu cúi
            camera.position.set(0, 1.5, 4);
            controls.target.set(0, 0.6, 0);
        } else {
            // Model face +Z → camera ở +Z thấy MẶT TRƯỚC
            camera.position.set(0, 1.5, 4);
            controls.target.set(0, 0.9, 0);
        }
        controls.update();
    }

    // Cập nhật trạng thái hiển thị
    let statusEl = document.getElementById('three-status');
    if (statusEl) {
        if (appliedCount > 0) {
            statusEl.innerHTML = 'Đã đồng bộ ' + appliedCount + ' khớp xương';
            statusEl.style.color = '#739E82';
        } else {
            statusEl.innerHTML = 'Không thể đồng bộ khớp xương';
            statusEl.style.color = '#C87979';
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

        // Camera — nhìn mặt trước nhân vật (model face -Z nên camera ở -Z)
        camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.set(0, 1.5, -4);

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
                characterModel.userData.originalY = -box.min.y;
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