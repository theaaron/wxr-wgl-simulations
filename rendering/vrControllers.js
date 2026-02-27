// vr controller input and ray visualization
import { pickVoxel } from './renderStructure.js';
import { triggerPanelButton, isHoveringPanel } from './vrPanel.js';

// pacing callback - set by main app
let paceCallback = null;

export function setPaceCallback(callback) {
    paceCallback = callback;
}

const RAY_LENGTH = 5.0;
const RAY_COLOR = [0.5, 0.5, 0.5];
const RAY_HIT_COLOR = [0.0, 1.0, 0.0];
const RAY_BUTTON_HIT_COLOR = [1.0, 0.8, 0.0]; // gold when hovering button
const RAY_RADIUS = 0.005;
const RAY_SEGMENTS = 8;

let leftController = null;
let rightController = null;
let rayProgram = null;
let rayCylinderBuffer = null;
let rayCylinderIndexBuffer = null;
let rayCylinderIndexCount = 0;

let leftHitDistance = null;
let rightHitDistance = null;

// vr ui button state
let vrButtonProgram = null;
let vrButtonBuffer = null;
let vrButtonIndexBuffer = null;
let leftHoveringButton = false;
let rightHoveringButton = false;

// button position and size (in world space)
const VR_BUTTON = {
    position: [0.3, 0.0, -0.8],
    width: 0.25,
    height: 0.12,
    normal: [0, 0, 1]
};

// vr button shaders
const VR_BUTTON_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform vec3 u_buttonPosition;
uniform vec2 u_buttonSize;

void main() {
    vec3 worldPos = a_position;
    worldPos.x *= u_buttonSize.x;
    worldPos.y *= u_buttonSize.y;
    worldPos += u_buttonPosition;
    gl_Position = u_projectionMatrix * u_viewMatrix * vec4(worldPos, 1.0);
}
`;

const VR_BUTTON_FS = `#version 300 es
precision highp float;
uniform vec3 u_buttonColor;
uniform float u_hovering;
out vec4 fragColor;

void main() {
    vec3 color = u_buttonColor;
    if (u_hovering > 0.5) {
        color = vec3(0.9, 0.75, 0.3); // highlight when hovering
    }
    fragColor = vec4(color, 1.0);
}
`;

// structure manipulation state
let structureTransform = {
    position: [0, 0, -0.5],
    rotation: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    scale: 0.2
};

let grabState = {
    leftGrabbing: false,
    rightGrabbing: false,
    leftMatrixAtGrab: null,
    rightMatrixAtGrab: null,
    leftGrabPoint: null,
    rightGrabPoint: null,
    structureAtGrab: null,
    structureOffsetAtGrab: null,
    initialHandDistance: null,
    midpointAtGrab: null
};

const RAY_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_rayMatrix;
uniform float u_rayLength;

void main() {
    vec3 scaledPos = a_position;
    scaledPos.z *= u_rayLength;
    
    vec4 worldPos = u_rayMatrix * vec4(scaledPos, 1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
}
`;

const RAY_FS = `#version 300 es
precision highp float;
uniform vec3 u_rayColor;
out vec4 fragColor;

void main() {
    fragColor = vec4(u_rayColor, 1.0);
}
`;

export function initVRControllers(gl) {
    console.log('🎮 Initializing VR controllers...');

    createRayCylinderGeometry(gl);
    rayProgram = createRayProgram(gl);

    createVRButtonGeometry(gl);
    vrButtonProgram = createVRButtonProgram(gl);

    if (rayProgram && vrButtonProgram) {
        console.log('✅ VR controller ray system initialized');
        console.log('✅ VR UI button initialized');
        return true;
    } else {
        console.error('❌ Failed to initialize VR controller system');
        return false;
    }
}

function createVRButtonGeometry(gl) {
    // Simple quad centered at origin, will be transformed by shader
    const vertices = new Float32Array([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
        -0.5, 0.5, 0
    ]);

    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    vrButtonBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vrButtonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    vrButtonIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vrButtonIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
}

function createVRButtonProgram(gl) {
    const vs = compileShader(gl, VR_BUTTON_VS, gl.VERTEX_SHADER);
    const fs = compileShader(gl, VR_BUTTON_FS, gl.FRAGMENT_SHADER);

    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('VR Button program link error:', gl.getProgramInfoLog(program));
        return null;
    }

    return program;
}

// Check if a ray intersects the VR button plane
function rayIntersectsButton(origin, direction) {
    const btnPos = VR_BUTTON.position;
    const btnNormal = VR_BUTTON.normal;

    // Plane equation: dot(normal, point - planePoint) = 0
    // Ray: origin + t * direction
    // Solve for t

    const denom = btnNormal[0] * direction.x + btnNormal[1] * direction.y + btnNormal[2] * direction.z;

    // Ray parallel to plane
    if (Math.abs(denom) < 0.0001) return null;

    const t = ((btnPos[0] - origin.x) * btnNormal[0] +
        (btnPos[1] - origin.y) * btnNormal[1] +
        (btnPos[2] - origin.z) * btnNormal[2]) / denom;

    // Intersection behind ray origin
    if (t < 0) return null;

    // Calculate intersection point
    const hitX = origin.x + t * direction.x;
    const hitY = origin.y + t * direction.y;
    const hitZ = origin.z + t * direction.z;

    // Check if hit is within button bounds
    const halfW = VR_BUTTON.width / 2;
    const halfH = VR_BUTTON.height / 2;

    const localX = hitX - btnPos[0];
    const localY = hitY - btnPos[1];

    if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
        return { distance: t, x: hitX, y: hitY, z: hitZ };
    }

    return null;
}

function createRayCylinderGeometry(gl) {
    const vertices = [];
    const indices = [];

    // cylinder from z=0 to z=-1, scaled by ray length in shader
    for (let i = 0; i <= RAY_SEGMENTS; i++) {
        const angle = (i / RAY_SEGMENTS) * Math.PI * 2;
        const x = Math.cos(angle) * RAY_RADIUS;
        const y = Math.sin(angle) * RAY_RADIUS;

        vertices.push(x, y, 0);    // top circle
        vertices.push(x, y, -1);   // bottom circle
    }

    for (let i = 0; i < RAY_SEGMENTS; i++) {
        const topLeft = i * 2;
        const topRight = (i + 1) * 2;
        const bottomLeft = i * 2 + 1;
        const bottomRight = (i + 1) * 2 + 1;

        indices.push(topLeft, bottomLeft, topRight);
        indices.push(topRight, bottomLeft, bottomRight);
    }

    // end cap
    const centerIndex = vertices.length / 3;
    vertices.push(0, 0, -1);

    for (let i = 0; i < RAY_SEGMENTS; i++) {
        const bottomLeft = i * 2 + 1;
        const bottomRight = (i + 1) * 2 + 1;
        indices.push(centerIndex, bottomRight, bottomLeft);
    }

    rayCylinderBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rayCylinderBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    rayCylinderIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rayCylinderIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    rayCylinderIndexCount = indices.length;
}

function createRayProgram(gl) {
    const vs = compileShader(gl, RAY_VS, gl.VERTEX_SHADER);
    const fs = compileShader(gl, RAY_FS, gl.FRAGMENT_SHADER);

    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Ray program link error:', gl.getProgramInfoLog(program));
        return null;
    }

    return program;
}

function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Ray shader compile error:', gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
}

export function setupControllerInput(session) {
    session.addEventListener('select', onSelect);
    session.addEventListener('selectstart', onSelectStart);
    session.addEventListener('selectend', onSelectEnd);
    session.addEventListener('squeeze', onSqueeze);
    session.addEventListener('squeezestart', onSqueezeStart);
    session.addEventListener('squeezeend', onSqueezeEnd);
}

function onSelect(event) {
    const inputSource = event.inputSource;

    if (inputSource.targetRayMode === 'tracked-pointer') {
        const hand = inputSource.handedness;
        const isGrabbing = (hand === 'left' && grabState.leftGrabbing) ||
            (hand === 'right' && grabState.rightGrabbing);

        // Check if pointing at panel button
        if (isHoveringPanel()) {
            // trigger while pointing at panel button = execute button action
            triggerPanelButton();
            return;
        }

        if (isGrabbing && paceCallback) {
            // grip + trigger = pace at ray intersection
            if (hand === 'left' && leftController) {
                requestPaceAtRay(leftController);
            } else if (hand === 'right' && rightController) {
                requestPaceAtRay(rightController);
            }
        } else {
            // trigger only = pick voxel
            if (hand === 'left' && leftController) {
                performGPUPick(leftController);
            } else if (hand === 'right' && rightController) {
                performGPUPick(rightController);
            }
        }
    }
}

function requestPaceAtRay(controller) {
    if (controller.handedness === 'left') {
        window.leftControllerPaceRequested = true;
    } else if (controller.handedness === 'right') {
        window.rightControllerPaceRequested = true;
    }
}

function onSelectStart(event) { }
function onSelectEnd(event) { }

function onSqueeze(event) { }

function onSqueezeStart(event) {
    const hand = event.inputSource.handedness;

    if (hand === 'left' && leftController) {
        grabState.leftGrabbing = true;
        grabState.leftMatrixAtGrab = new Float32Array(leftController.matrix);
        grabState.leftGrabPoint = [leftController.origin.x, leftController.origin.y, leftController.origin.z];
    } else if (hand === 'right' && rightController) {
        grabState.rightGrabbing = true;
        grabState.rightMatrixAtGrab = new Float32Array(rightController.matrix);
        grabState.rightGrabPoint = [rightController.origin.x, rightController.origin.y, rightController.origin.z];
    }

    if (grabState.leftGrabbing && grabState.rightGrabbing) {
        grabState.initialHandDistance = getHandDistance();
        grabState.midpointAtGrab = getHandMidpoint();
    }

    grabState.structureAtGrab = {
        position: [...structureTransform.position],
        rotation: new Float32Array(structureTransform.rotation),
        scale: structureTransform.scale
    };

    // store offset from controller to structure at grab time
    const grabPoint = grabState.leftGrabbing ?
        (grabState.leftGrabPoint || [0, 0, 0]) :
        (grabState.rightGrabPoint || [0, 0, 0]);
    grabState.structureOffsetAtGrab = [
        structureTransform.position[0] - grabPoint[0],
        structureTransform.position[1] - grabPoint[1],
        structureTransform.position[2] - grabPoint[2]
    ];
}

function onSqueezeEnd(event) {
    const hand = event.inputSource.handedness;
    if (hand === 'left') grabState.leftGrabbing = false;
    else if (hand === 'right') grabState.rightGrabbing = false;
}

function getHandDistance() {
    if (!leftController || !rightController) return 1;
    const dx = leftController.origin.x - rightController.origin.x;
    const dy = leftController.origin.y - rightController.origin.y;
    const dz = leftController.origin.z - rightController.origin.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getHandMidpoint() {
    if (!leftController || !rightController) return [0, 0, 0];
    return [
        (leftController.origin.x + rightController.origin.x) / 2,
        (leftController.origin.y + rightController.origin.y) / 2,
        (leftController.origin.z + rightController.origin.z) / 2
    ];
}

let pickingFBO = null;
let pickingTexture = null;
let pickingDepthBuffer = null;
let pickingPixelBuffer = null;
const PICK_RESOLUTION = 64;

function performGPUPick(controller) {
    if (controller.handedness === 'left') {
        window.leftControllerPickRequested = true;
    } else if (controller.handedness === 'right') {
        window.rightControllerPickRequested = true;
    }
}

export function processControllerPick(gl, controller, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer) {
    if (!controller || !pickingProgram || !structure) return null;
    if (!positionBuffer || !instanceIDBuffer) return null;
    if (!cubeBuffer || !indexBuffer) return null;

    if (!pickingFBO) {
        initPickingFBO(gl);
    }

    // narrow FOV for precise picking
    const pickProjMatrix = createPickProjectionMatrix(10);
    const pickViewMatrix = invertMatrix(controller.matrix);

    // combine manipulation matrix with base structure matrix
    // use dynamic globalScale from window (set by renderStructure)
    const globalScale = window.renderStructureGlobalScale || 0.02;
    const zScale = 1.0;
    const baseMatrix = new Float32Array([
        globalScale, 0, 0, 0,
        0, globalScale, 0, 0,
        0, 0, globalScale * zScale, 0,
        0, 0, -1, 1
    ]);
    const actualModelMatrix = multiplyMat4(modelMatrix, baseMatrix);

    const voxelScale = window.renderStructureVoxelScale || 5.0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, pickingFBO);
    gl.viewport(0, 0, PICK_RESOLUTION, PICK_RESOLUTION);
    gl.clearColor(1.0, 0.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);

    gl.useProgram(pickingProgram);

    const projLoc = gl.getUniformLocation(pickingProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(pickingProgram, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(pickingProgram, 'u_modelMatrix');
    const scaleLoc = gl.getUniformLocation(pickingProgram, 'u_cubeScale');

    gl.uniformMatrix4fv(projLoc, false, pickProjMatrix);
    gl.uniformMatrix4fv(viewLoc, false, pickViewMatrix);
    gl.uniformMatrix4fv(modelLoc, false, actualModelMatrix);
    gl.uniform1f(scaleLoc, voxelScale);

    const posLoc = gl.getAttribLocation(pickingProgram, 'a_position');
    const instPosLoc = gl.getAttribLocation(pickingProgram, 'a_instancePosition');
    const instIDLoc = gl.getAttribLocation(pickingProgram, 'a_instanceID');

    if (posLoc === -1 || instPosLoc === -1 || instIDLoc === -1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribDivisor(posLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    gl.vertexAttribDivisor(instPosLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceIDBuffer);
    gl.vertexAttribPointer(instIDLoc, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instIDLoc);
    gl.vertexAttribDivisor(instIDLoc, 1);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, structure.voxels.length);

    const centerX = Math.floor(PICK_RESOLUTION / 2);
    const centerY = Math.floor(PICK_RESOLUTION / 2);

    if (!pickingPixelBuffer) {
        pickingPixelBuffer = new Uint8Array(4);
    }

    gl.readPixels(centerX, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickingPixelBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const pixel = pickingPixelBuffer;

    // magenta = no hit (clear color)
    if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255) {
        return null;
    }

    const instanceID = pixel[0] * 65536 + pixel[1] * 256 + pixel[2];

    if (instanceID >= structure.voxels.length) {
        return null;
    }

    const voxel = structure.voxels[instanceID];

    // calculate world position by transforming through the full model matrix
    const centerVoxX = structure.dimensions.nx / 2;
    const centerVoxY = structure.dimensions.ny / 2;
    const centerVoxZ = structure.dimensions.nz / 2;

    // local position (before model matrix)
    const localX = voxel.x - centerVoxX;
    const localY = voxel.y - centerVoxY;
    const localZ = voxel.z - centerVoxZ;

    // transform through full model matrix (includes grab/rotate/scale)
    const m = actualModelMatrix;
    const voxelWorldX = m[0] * localX + m[4] * localY + m[8] * localZ + m[12];
    const voxelWorldY = m[1] * localX + m[5] * localY + m[9] * localZ + m[13];
    const voxelWorldZ = m[2] * localX + m[6] * localY + m[10] * localZ + m[14];

    // project onto ray direction for hit distance
    const toVoxelX = voxelWorldX - controller.origin.x;
    const toVoxelY = voxelWorldY - controller.origin.y;
    const toVoxelZ = voxelWorldZ - controller.origin.z;

    const dirX = controller.direction.x;
    const dirY = controller.direction.y;
    const dirZ = controller.direction.z;

    const distanceAlongRay = toVoxelX * dirX + toVoxelY * dirY + toVoxelZ * dirZ;

    // subtract half voxel size to stop ray at surface
    const voxelWorldSize = voxelScale * globalScale * (modelMatrix[0] || 1);
    const hitDistance = Math.max(0.01, distanceAlongRay - voxelWorldSize * 0.5);

    return {
        instanceID,
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        value: voxel.value,
        worldX: voxelWorldX,
        worldY: voxelWorldY,
        worldZ: voxelWorldZ,
        handedness: controller.handedness,
        hitDistance: hitDistance
    };
}

function initPickingFBO(gl) {
    pickingTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pickingTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PICK_RESOLUTION, PICK_RESOLUTION, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    pickingDepthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, pickingDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, PICK_RESOLUTION, PICK_RESOLUTION);

    pickingFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickingFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickingTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickingDepthBuffer);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function createPickProjectionMatrix(fovDegrees) {
    const fov = fovDegrees * Math.PI / 180;
    const aspect = 1.0;
    const near = 0.01;
    const far = 100.0;
    const f = 1.0 / Math.tan(fov / 2);

    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0
    ]);
}

function invertMatrix(mat) {
    const m = mat;
    const out = new Float32Array(16);

    // transpose rotation
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
    out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
    out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;

    // transform translation
    const tx = -m[12];
    const ty = -m[13];
    const tz = -m[14];

    out[12] = tx * out[0] + ty * out[4] + tz * out[8];
    out[13] = tx * out[1] + ty * out[5] + tz * out[9];
    out[14] = tx * out[2] + ty * out[6] + tz * out[10];
    out[15] = 1;

    return out;
}

export function updateControllers(frame, referenceSpace) {
    if (!frame || !referenceSpace) return;

    for (const inputSource of frame.session.inputSources) {
        if (inputSource.targetRayMode === 'tracked-pointer') {
            const pose = frame.getPose(inputSource.targetRaySpace, referenceSpace);

            if (pose) {
                const matrix = pose.transform.matrix;

                const controllerData = {
                    matrix: matrix,
                    origin: {
                        x: matrix[12],
                        y: matrix[13],
                        z: matrix[14]
                    },
                    direction: {
                        x: -matrix[8],
                        y: -matrix[9],
                        z: -matrix[10]
                    },
                    handedness: inputSource.handedness
                };

                if (inputSource.handedness === 'left') {
                    leftController = controllerData;
                } else if (inputSource.handedness === 'right') {
                    rightController = controllerData;
                }
            }
        }
    }
}

export function renderControllerRays(gl, projectionMatrix, viewMatrix) {
    if (!rayProgram || !rayCylinderBuffer) return;

    // Check button hover state
    leftHoveringButton = false;
    rightHoveringButton = false;

    if (leftController) {
        const btnHit = rayIntersectsButton(leftController.origin, leftController.direction);
        if (btnHit) {
            leftHoveringButton = true;
        }
    }

    if (rightController) {
        const btnHit = rayIntersectsButton(rightController.origin, rightController.direction);
        if (btnHit) {
            rightHoveringButton = true;
        }
    }

    gl.useProgram(rayProgram);

    const projLoc = gl.getUniformLocation(rayProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(rayProgram, 'u_viewMatrix');
    const rayMatrixLoc = gl.getUniformLocation(rayProgram, 'u_rayMatrix');
    const colorLoc = gl.getUniformLocation(rayProgram, 'u_rayColor');
    const rayLengthLoc = gl.getUniformLocation(rayProgram, 'u_rayLength');

    gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);

    const posLoc = gl.getAttribLocation(rayProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, rayCylinderBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rayCylinderIndexBuffer);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    if (leftController) {
        const hasStructureHit = lastLeftPick !== null;
        let leftColor = RAY_COLOR;
        if (leftHoveringButton) {
            leftColor = RAY_BUTTON_HIT_COLOR;
        } else if (hasStructureHit) {
            leftColor = RAY_HIT_COLOR;
        }
        const leftLength = leftHitDistance !== null ? leftHitDistance : RAY_LENGTH;

        gl.uniform3fv(colorLoc, leftColor);
        gl.uniform1f(rayLengthLoc, leftLength);
        gl.uniformMatrix4fv(rayMatrixLoc, false, leftController.matrix);
        gl.drawElements(gl.TRIANGLES, rayCylinderIndexCount, gl.UNSIGNED_SHORT, 0);
    }

    if (rightController) {
        const hasStructureHit = lastRightPick !== null;
        let rightColor = RAY_COLOR;
        if (rightHoveringButton) {
            rightColor = RAY_BUTTON_HIT_COLOR;
        } else if (hasStructureHit) {
            rightColor = RAY_HIT_COLOR;
        }
        const rightLength = rightHitDistance !== null ? rightHitDistance : RAY_LENGTH;

        gl.uniform3fv(colorLoc, rightColor);
        gl.uniform1f(rayLengthLoc, rightLength);
        gl.uniformMatrix4fv(rayMatrixLoc, false, rightController.matrix);
        gl.drawElements(gl.TRIANGLES, rayCylinderIndexCount, gl.UNSIGNED_SHORT, 0);
    }
}

// Render the VR UI button panel
export function renderVRButton(gl, projectionMatrix, viewMatrix) {
    if (!vrButtonProgram || !vrButtonBuffer) return;

    gl.useProgram(vrButtonProgram);

    const projLoc = gl.getUniformLocation(vrButtonProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(vrButtonProgram, 'u_viewMatrix');
    const positionLoc = gl.getUniformLocation(vrButtonProgram, 'u_buttonPosition');
    const sizeLoc = gl.getUniformLocation(vrButtonProgram, 'u_buttonSize');
    const colorLoc = gl.getUniformLocation(vrButtonProgram, 'u_buttonColor');
    const hoveringLoc = gl.getUniformLocation(vrButtonProgram, 'u_hovering');

    gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniform3fv(positionLoc, VR_BUTTON.position);
    gl.uniform2f(sizeLoc, VR_BUTTON.width, VR_BUTTON.height);

    // Georgia Tech gold color
    gl.uniform3f(colorLoc, 0.7, 0.64, 0.41);

    // Highlight if either controller is hovering
    const isHovering = leftHoveringButton || rightHoveringButton;
    gl.uniform1f(hoveringLoc, isHovering ? 1.0 : 0.0);

    const posLoc = gl.getAttribLocation(vrButtonProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, vrButtonBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vrButtonIndexBuffer);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

export function getLeftController() {
    return leftController;
}

export function getRightController() {
    return rightController;
}

export function hasActiveControllers() {
    return leftController !== null || rightController !== null;
}

export function updateStructureManipulation() {
    const leftGrab = grabState.leftGrabbing;
    const rightGrab = grabState.rightGrabbing;

    if (!leftGrab && !rightGrab) return;
    if (!grabState.structureAtGrab) return;

    if (leftGrab && rightGrab && leftController && rightController) {
        // two-handed: translate + rotate + scale
        const currentDistance = getHandDistance();
        const scaleFactor = currentDistance / grabState.initialHandDistance;
        structureTransform.scale = grabState.structureAtGrab.scale * scaleFactor;

        const currentMidpoint = getHandMidpoint();
        structureTransform.position = [
            grabState.structureAtGrab.position[0] + (currentMidpoint[0] - grabState.midpointAtGrab[0]),
            grabState.structureAtGrab.position[1] + (currentMidpoint[1] - grabState.midpointAtGrab[1]),
            grabState.structureAtGrab.position[2] + (currentMidpoint[2] - grabState.midpointAtGrab[2])
        ];

        // rotation from hand vector change
        const grabVec = [
            grabState.rightMatrixAtGrab[12] - grabState.leftMatrixAtGrab[12],
            grabState.rightMatrixAtGrab[13] - grabState.leftMatrixAtGrab[13],
            grabState.rightMatrixAtGrab[14] - grabState.leftMatrixAtGrab[14]
        ];
        const currentVec = [
            rightController.origin.x - leftController.origin.x,
            rightController.origin.y - leftController.origin.y,
            rightController.origin.z - leftController.origin.z
        ];
        const rotMatrix = rotationBetweenVectors(grabVec, currentVec);
        structureTransform.rotation = multiplyMat4(rotMatrix, grabState.structureAtGrab.rotation);

    } else {
        // one-handed: translate + rotate, pivoting around hand
        const controller = leftGrab ? leftController : rightController;
        const matrixAtGrab = leftGrab ? grabState.leftMatrixAtGrab : grabState.rightMatrixAtGrab;

        if (!controller || !matrixAtGrab) return;

        const deltaMatrix = multiplyMat4(controller.matrix, invertMat4(matrixAtGrab));
        const deltaRot = extractRotation(deltaMatrix);

        // rotate the offset from hand to structure, then add to current hand position
        const offset = grabState.structureOffsetAtGrab || [0, 0, 0];
        const rotatedOffset = transformVec3(deltaRot, offset);

        structureTransform.position = [
            controller.origin.x + rotatedOffset[0],
            controller.origin.y + rotatedOffset[1],
            controller.origin.z + rotatedOffset[2]
        ];

        structureTransform.rotation = multiplyMat4(deltaRot, grabState.structureAtGrab.rotation);
    }
}

export function getStructureModelMatrix() {
    const m = new Float32Array(16);
    const pos = structureTransform.position;
    const rot = structureTransform.rotation;
    const s = structureTransform.scale;

    // scale the rotation part
    m[0] = rot[0] * s; m[1] = rot[1] * s; m[2] = rot[2] * s; m[3] = 0;
    m[4] = rot[4] * s; m[5] = rot[5] * s; m[6] = rot[6] * s; m[7] = 0;
    m[8] = rot[8] * s; m[9] = rot[9] * s; m[10] = rot[10] * s; m[11] = 0;
    m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;

    return m;
}

export function resetStructureTransform() {
    structureTransform.position = [0, 0, 0];
    structureTransform.rotation = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    structureTransform.scale = 1.0;
}

export function setHandGrabState(hand, grabbing, matrix, origin) {
    if (hand === 'left') {
        grabState.leftGrabbing = grabbing;
        if (grabbing && matrix && origin) {
            grabState.leftMatrixAtGrab = new Float32Array(matrix);
            grabState.leftGrabPoint = [origin.x, origin.y, origin.z];
            if (hand === 'left') leftController = { matrix, origin, direction: { x: -matrix[8], y: -matrix[9], z: -matrix[10] }, handedness: 'left' };
        }
    } else {
        grabState.rightGrabbing = grabbing;
        if (grabbing && matrix && origin) {
            grabState.rightMatrixAtGrab = new Float32Array(matrix);
            grabState.rightGrabPoint = [origin.x, origin.y, origin.z];
            if (hand === 'right') rightController = { matrix, origin, direction: { x: -matrix[8], y: -matrix[9], z: -matrix[10] }, handedness: 'right' };
        }
    }

    if (grabbing) {
        grabState.structureAtGrab = {
            position: [...structureTransform.position],
            rotation: new Float32Array(structureTransform.rotation),
            scale: structureTransform.scale
        };
        const grabPt = hand === 'left' ? grabState.leftGrabPoint : grabState.rightGrabPoint;
        grabState.structureOffsetAtGrab = [
            structureTransform.position[0] - grabPt[0],
            structureTransform.position[1] - grabPt[1],
            structureTransform.position[2] - grabPt[2]
        ];
        if (grabState.leftGrabbing && grabState.rightGrabbing) {
            grabState.initialHandDistance = getHandDistance();
            grabState.midpointAtGrab = getHandMidpoint();
        }
    }
}

export function updateHandControllerPose(hand, matrix) {
    const pose = {
        matrix,
        origin: { x: matrix[12], y: matrix[13], z: matrix[14] },
        direction: { x: -matrix[8], y: -matrix[9], z: -matrix[10] },
        handedness: hand
    };
    if (hand === 'left') leftController = pose;
    else rightController = pose;
}

// matrix math helpers (column-major for WebGL)
function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
        }
    }
    return out;
}

function invertMat4(m) {
    const out = new Float32Array(16);
    // transpose rotation
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
    out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
    out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
    // transform translation
    const tx = -m[12], ty = -m[13], tz = -m[14];
    out[12] = tx * out[0] + ty * out[4] + tz * out[8];
    out[13] = tx * out[1] + ty * out[5] + tz * out[9];
    out[14] = tx * out[2] + ty * out[6] + tz * out[10];
    out[15] = 1;
    return out;
}

function extractRotation(m) {
    const out = new Float32Array(16);
    out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = 0;
    out[4] = m[4]; out[5] = m[5]; out[6] = m[6]; out[7] = 0;
    out[8] = m[8]; out[9] = m[9]; out[10] = m[10]; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
}

function transformVec3(m, v) {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
    ];
}

function rotationBetweenVectors(from, to) {
    const out = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    // normalize
    const fromLen = Math.sqrt(from[0] * from[0] + from[1] * from[1] + from[2] * from[2]);
    const toLen = Math.sqrt(to[0] * to[0] + to[1] * to[1] + to[2] * to[2]);
    if (fromLen < 0.0001 || toLen < 0.0001) return out;

    const fx = from[0] / fromLen, fy = from[1] / fromLen, fz = from[2] / fromLen;
    const tx = to[0] / toLen, ty = to[1] / toLen, tz = to[2] / toLen;

    // cross product for axis
    const cx = fy * tz - fz * ty;
    const cy = fz * tx - fx * tz;
    const cz = fx * ty - fy * tx;

    const dot = fx * tx + fy * ty + fz * tz;
    const axisLen = Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (axisLen < 0.0001) return out;

    const ax = cx / axisLen, ay = cy / axisLen, az = cz / axisLen;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;

    out[0] = t * ax * ax + c; out[1] = t * ax * ay + s * az; out[2] = t * ax * az - s * ay;
    out[4] = t * ax * ay - s * az; out[5] = t * ay * ay + c; out[6] = t * ay * az + s * ax;
    out[8] = t * ax * az + s * ay; out[9] = t * ay * az - s * ax; out[10] = t * az * az + c;

    return out;
}

let lastLeftPick = null;
let lastRightPick = null;

export function checkAndProcessPicks(gl, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer) {
    if (leftController) {
        const picked = processControllerPick(gl, leftController, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer);

        lastLeftPick = picked;
        leftHitDistance = picked ? picked.hitDistance : null;

        if (window.leftControllerPickRequested) {
            window.leftControllerPickRequested = false;
            if (lastLeftPick && window.addPickedVoxel) {
                window.addPickedVoxel(lastLeftPick.instanceID);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('🎮 LEFT CONTROLLER PICKED VOXEL:');
                console.log(`   Instance ID: ${lastLeftPick.instanceID}`);
                console.log(`   Grid Coordinates: (${lastLeftPick.x}, ${lastLeftPick.y}, ${lastLeftPick.z})`);
                console.log(`   World Position: (${lastLeftPick.worldX.toFixed(3)}, ${lastLeftPick.worldY.toFixed(3)}, ${lastLeftPick.worldZ.toFixed(3)})`);
                console.log(`   Value: ${lastLeftPick.value}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }
        }

        // pacing: grip + trigger
        if (window.leftControllerPaceRequested) {
            window.leftControllerPaceRequested = false;
            if (lastLeftPick && paceCallback) {
                paceCallback(lastLeftPick.x, lastLeftPick.y, lastLeftPick.z);
                console.log(`⚡ LEFT CONTROLLER PACED at (${lastLeftPick.x}, ${lastLeftPick.y}, ${lastLeftPick.z})`);
            }
        }
    } else {
        lastLeftPick = null;
        leftHitDistance = null;
    }

    if (window.leftControllerPickRequested) {
        window.leftControllerPickRequested = false;
    }
    if (window.leftControllerPaceRequested) {
        window.leftControllerPaceRequested = false;
    }

    if (rightController) {
        const picked = processControllerPick(gl, rightController, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer);

        lastRightPick = picked;
        rightHitDistance = picked ? picked.hitDistance : null;

        if (window.rightControllerPickRequested) {
            window.rightControllerPickRequested = false;
            if (lastRightPick && window.addPickedVoxel) {
                window.addPickedVoxel(lastRightPick.instanceID);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('🎮 RIGHT CONTROLLER PICKED VOXEL:');
                console.log(`   Instance ID: ${lastRightPick.instanceID}`);
                console.log(`   Grid Coordinates: (${lastRightPick.x}, ${lastRightPick.y}, ${lastRightPick.z})`);
                console.log(`   World Position: (${lastRightPick.worldX.toFixed(3)}, ${lastRightPick.worldY.toFixed(3)}, ${lastRightPick.worldZ.toFixed(3)})`);
                console.log(`   Value: ${lastRightPick.value}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }
        }

        // pacing: grip + trigger
        if (window.rightControllerPaceRequested) {
            window.rightControllerPaceRequested = false;
            if (lastRightPick && paceCallback) {
                paceCallback(lastRightPick.x, lastRightPick.y, lastRightPick.z);
                console.log(`⚡ RIGHT CONTROLLER PACED at (${lastRightPick.x}, ${lastRightPick.y}, ${lastRightPick.z})`);
            }
        }
    } else {
        lastRightPick = null;
        rightHitDistance = null;
    }

    if (window.rightControllerPickRequested) {
        window.rightControllerPickRequested = false;
    }
    if (window.rightControllerPaceRequested) {
        window.rightControllerPaceRequested = false;
    }
}

export function getLastLeftPick() {
    return lastLeftPick;
}

export function getLastRightPick() {
    return lastRightPick;
}

export function isControllerSqueezing(hand) {
    return hand === 'left' ? grabState.leftGrabbing : grabState.rightGrabbing;
}
