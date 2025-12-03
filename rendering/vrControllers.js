// vr controller input and ray visualization
import { pickVoxel } from './renderStructure.js';

const RAY_LENGTH = 5.0;
const RAY_COLOR = [0.5, 0.5, 0.5];
const RAY_HIT_COLOR = [0.0, 1.0, 0.0];
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
    
    if (rayProgram) {
        console.log('✅ VR controller ray system initialized');
        return true;
    } else {
        console.error('❌ Failed to initialize VR controller system');
        return false;
    }
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
}

function onSelect(event) {
    const inputSource = event.inputSource;
    
    if (inputSource.targetRayMode === 'tracked-pointer') {
        if (inputSource.handedness === 'left' && leftController) {
            performGPUPick(leftController);
        } else if (inputSource.handedness === 'right' && rightController) {
            performGPUPick(rightController);
        }
    }
}

function onSelectStart(event) {}
function onSelectEnd(event) {}

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
    
    // must match renderStructure model matrix
    const globalScale = 0.02;
    const zScale = 1.0;
    const actualModelMatrix = new Float32Array([
        globalScale, 0, 0, 0,
        0, globalScale, 0, 0,
        0, 0, globalScale * zScale, 0,
        0, 0, -1, 1
    ]);
    
    const voxelScale = window.renderStructureVoxelScale || 3.0;
    
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
    
    // calculate world position (same as renderStructure)
    const centerVoxX = structure.dimensions.nx / 2;
    const centerVoxY = structure.dimensions.ny / 2;
    const centerVoxZ = structure.dimensions.nz / 2;
    
    const voxelWorldX = (voxel.x - centerVoxX) * globalScale;
    const voxelWorldY = (voxel.y - centerVoxY) * globalScale;
    const voxelWorldZ = (voxel.z - centerVoxZ) * globalScale - 1;
    
    // project onto ray direction for hit distance
    const toVoxelX = voxelWorldX - controller.origin.x;
    const toVoxelY = voxelWorldY - controller.origin.y;
    const toVoxelZ = voxelWorldZ - controller.origin.z;
    
    const dirX = controller.direction.x;
    const dirY = controller.direction.y;
    const dirZ = controller.direction.z;
    
    const distanceAlongRay = toVoxelX * dirX + toVoxelY * dirY + toVoxelZ * dirZ;
    
    const voxelWorldSize = voxelScale * globalScale;
    const hitDistance = Math.max(0.01, distanceAlongRay - voxelWorldSize * 0.1);
    
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
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8];  out[3] = 0;
    out[4] = m[1]; out[5] = m[5]; out[6] = m[9];  out[7] = 0;
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
        const hasHit = lastLeftPick !== null;
        const leftColor = hasHit ? RAY_HIT_COLOR : RAY_COLOR;
        const leftLength = leftHitDistance !== null ? leftHitDistance : RAY_LENGTH;
        
        gl.uniform3fv(colorLoc, leftColor);
        gl.uniform1f(rayLengthLoc, leftLength);
        gl.uniformMatrix4fv(rayMatrixLoc, false, leftController.matrix);
        gl.drawElements(gl.TRIANGLES, rayCylinderIndexCount, gl.UNSIGNED_SHORT, 0);
    }
    
    if (rightController) {
        const hasHit = lastRightPick !== null;
        const rightColor = hasHit ? RAY_HIT_COLOR : RAY_COLOR;
        const rightLength = rightHitDistance !== null ? rightHitDistance : RAY_LENGTH;
        
        gl.uniform3fv(colorLoc, rightColor);
        gl.uniform1f(rayLengthLoc, rightLength);
        gl.uniformMatrix4fv(rayMatrixLoc, false, rightController.matrix);
        gl.drawElements(gl.TRIANGLES, rayCylinderIndexCount, gl.UNSIGNED_SHORT, 0);
    }
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
    } else {
        lastLeftPick = null;
        leftHitDistance = null;
    }
    
    if (window.leftControllerPickRequested) {
        window.leftControllerPickRequested = false;
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
    } else {
        lastRightPick = null;
        rightHitDistance = null;
    }
    
    if (window.rightControllerPickRequested) {
        window.rightControllerPickRequested = false;
    }
}

export function getLastLeftPick() {
    return lastLeftPick;
}

export function getLastRightPick() {
    return lastRightPick;
}
