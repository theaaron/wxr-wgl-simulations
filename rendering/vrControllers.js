// VR controller input and ray visualization
import { pickVoxel } from './renderStructure.js';

const RAY_LENGTH = 5.0;
const RAY_COLOR = [0.5, 0.5, 0.5];

let leftController = null;
let rightController = null;
let rayLineBuffer = null;
let rayProgram = null;

const RAY_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_rayMatrix;

void main() {
    vec4 worldPos = u_rayMatrix * vec4(a_position, 1.0);
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
    
    const rayVertices = new Float32Array([
        0.0, 0.0, 0.0,
        0.0, 0.0, -RAY_LENGTH
    ]);
    
    rayLineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rayLineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rayVertices, gl.STATIC_DRAW);
    
    rayProgram = createRayProgram(gl);
    
    if (rayProgram) {
        console.log('✅ VR controller ray system initialized');
        return true;
    } else {
        console.error('❌ Failed to initialize VR controller system');
        return false;
    }
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
    console.log('🎮 Setting up controller input listeners...');
    
    session.addEventListener('select', onSelect);
    session.addEventListener('selectstart', onSelectStart);
    session.addEventListener('selectend', onSelectEnd);
    
    console.log('✅ Controller input listeners registered');
}

function onSelect(event) {
    console.log('🎮 Controller SELECT (trigger pressed)');
    
    const inputSource = event.inputSource;
    const frame = event.frame;
    
    if (inputSource.targetRayMode === 'tracked-pointer') {
        if (inputSource.handedness === 'left') {
            if (leftController) {
                console.log('🎯 Left controller select event!');
                performGPUPick(leftController);
            }
        } else if (inputSource.handedness === 'right') {
            if (rightController) {
                console.log('🎯 Right controller select event!');
                performGPUPick(rightController);
            }
        }
    }
}

function onSelectStart(event) {
    console.log('🎮 Controller trigger DOWN');
}

function onSelectEnd(event) {
    console.log('🎮 Controller trigger UP');
}

let pickingFBO = null;
let pickingTexture = null;
let pickingDepthBuffer = null;
let pickingPixelBuffer = null;
const PICK_RESOLUTION = 64;

function performGPUPick(controller) {
    console.log('🎯 GPU pick requested at controller ray:', {
        origin: controller.origin,
        direction: controller.direction,
        handedness: controller.handedness
    });
    
    if (controller.handedness === 'left') {
        window.leftControllerPickRequested = true;
    } else if (controller.handedness === 'right') {
        window.rightControllerPickRequested = true;
    }
}


export function processControllerPick(gl, controller, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer) {
    if (!controller || !pickingProgram || !structure) return null;
    if (!positionBuffer || !instanceIDBuffer) {
        console.warn('⚠️ Pick failed: instance buffers not ready');
        return null;
    }
    if (!cubeBuffer || !indexBuffer) {
        console.warn('⚠️ Pick failed: cube geometry buffers not ready');
        return null;
    }
    
    if (!pickingFBO) {
        initPickingFBO(gl);
    }
    
    const pickProjMatrix = createPickProjectionMatrix(90);
    const pickViewMatrix = invertMatrix(controller.matrix);
    
    if (!processControllerPick.debugLogged) {
        console.log('🔍 DEBUG: Controller picking setup');
        console.log('  Controller origin:', controller.origin);
        console.log('  Controller direction:', controller.direction);
        console.log('  Number of voxels:', structure.voxels.length);
        console.log('  First voxel:', structure.voxels[0]);
        console.log('  Model matrix:', Array.from(modelMatrix));
        console.log('  Position buffer:', positionBuffer);
        console.log('  Instance ID buffer:', instanceIDBuffer);
        console.log('  Cube buffer:', cubeBuffer);
        console.log('  Index buffer:', indexBuffer);
        console.log('  Projection matrix:', Array.from(pickProjMatrix));
        console.log('  View matrix (first 8 elements):', Array.from(pickViewMatrix).slice(0, 8));
        processControllerPick.debugLogged = true;
    }
    
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
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    gl.uniform1f(scaleLoc, 0.02);
    
    const posLoc = gl.getAttribLocation(pickingProgram, 'a_position');
    const instPosLoc = gl.getAttribLocation(pickingProgram, 'a_instancePosition');
    const instIDLoc = gl.getAttribLocation(pickingProgram, 'a_instanceID');
    
    if (!processControllerPick.attrLogged) {
        console.log('🔍 Attribute locations:', { posLoc, instPosLoc, instIDLoc });
        processControllerPick.attrLogged = true;
    }
    
    if (posLoc === -1 || instPosLoc === -1 || instIDLoc === -1) {
        console.error('❌ Invalid attribute locations:', { posLoc, instPosLoc, instIDLoc });
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
    
    const errBefore = gl.getError();
    if (errBefore !== gl.NO_ERROR) {
        console.error('❌ GL error before pick draw:', errBefore);
    }
    
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, structure.voxels.length);
    
    const errAfter = gl.getError();
    if (errAfter !== gl.NO_ERROR) {
        console.error('❌ GL error after pick draw:', errAfter);
    }
    
    // Read center pixel
    const centerX = Math.floor(PICK_RESOLUTION / 2);
    const centerY = Math.floor(PICK_RESOLUTION / 2);
    
    if (!pickingPixelBuffer) {
        pickingPixelBuffer = new Uint8Array(4);
    }
    
    gl.readPixels(centerX, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickingPixelBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    const pixel = pickingPixelBuffer;
    
    if (!processControllerPick.pickCount) processControllerPick.pickCount = 0;
    processControllerPick.pickCount++;
    
    if (processControllerPick.pickCount <= 5) {
        console.log(`🔍 Pick #${processControllerPick.pickCount} pixel RGBA: [${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3]}]`);
    }
    
    if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255) {
        return null;
    }
    
    const instanceID = pixel[0] * 65536 + pixel[1] * 256 + pixel[2];
    
    if (instanceID >= structure.voxels.length) {
        console.warn('⚠️ Invalid pick ID:', instanceID);
        return null;
    }
    
    const voxel = structure.voxels[instanceID];
    
    return {
        instanceID,
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        value: voxel.value,
        handedness: controller.handedness
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
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('❌ Picking FBO incomplete:', status);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.log('✅ Controller picking FBO initialized');
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
    
    // transpose rotation (top-left 3x3)
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8];  out[3] = 0;
    out[4] = m[1]; out[5] = m[5]; out[6] = m[9];  out[7] = 0;
    out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
    
    // negate and transform translation
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
    if (!rayProgram || !rayLineBuffer) return;
    
    gl.useProgram(rayProgram);
    
    const projLoc = gl.getUniformLocation(rayProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(rayProgram, 'u_viewMatrix');
    const rayMatrixLoc = gl.getUniformLocation(rayProgram, 'u_rayMatrix');
    const colorLoc = gl.getUniformLocation(rayProgram, 'u_rayColor');
    
    gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    const posLoc = gl.getAttribLocation(rayProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, rayLineBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    const depthTestWasEnabled = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    
    if (leftController) {
        const leftColor = lastLeftPick ? [0.0, 1.0, 0.0] : RAY_COLOR;
        gl.uniform3fv(colorLoc, leftColor);
        gl.uniformMatrix4fv(rayMatrixLoc, false, leftController.matrix);
        gl.drawArrays(gl.LINES, 0, 2);
    }
    
    if (rightController) {
        const rightColor = lastRightPick ? [0.0, 1.0, 0.0] : RAY_COLOR;
        gl.uniform3fv(colorLoc, rightColor);
        gl.uniformMatrix4fv(rayMatrixLoc, false, rightController.matrix);
        gl.drawArrays(gl.LINES, 0, 2);
    }
    
    if (depthTestWasEnabled) {
        gl.enable(gl.DEPTH_TEST);
    }
}

// ============================================================================
// GETTERS
// ============================================================================

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
        
        if (picked && (!lastLeftPick || lastLeftPick.instanceID !== picked.instanceID)) {
            console.log('👈 LEFT controller hovering:', picked.instanceID, `(${picked.x},${picked.y},${picked.z})`);
            lastLeftPick = picked;
        } else if (!picked && lastLeftPick) {
            console.log('👈 LEFT controller: no hit');
            lastLeftPick = null;
        } else if (picked) {
            lastLeftPick = picked;
        }
        
        if (window.leftControllerPickRequested) {
            window.leftControllerPickRequested = false;
            if (picked && window.addPickedVoxel) {
                window.addPickedVoxel(picked.instanceID);
                console.log('✅ LEFT controller SELECTED:', picked.instanceID);
            }
        }
    }
    
    if (window.leftControllerPickRequested) {
        window.leftControllerPickRequested = false;
    }
    
    if (rightController) {
        const picked = processControllerPick(gl, rightController, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer);
        
        if (picked && (!lastRightPick || lastRightPick.instanceID !== picked.instanceID)) {
            console.log('👉 RIGHT controller hovering:', picked.instanceID, `(${picked.x},${picked.y},${picked.z})`);
            lastRightPick = picked;
        } else if (!picked && lastRightPick) {
            console.log('👉 RIGHT controller: no hit');
            lastRightPick = null;
        } else if (picked) {
            lastRightPick = picked;
        }
        
        if (window.rightControllerPickRequested) {
            window.rightControllerPickRequested = false;
            if (picked && window.addPickedVoxel) {
                window.addPickedVoxel(picked.instanceID);
                console.log('✅ RIGHT controller SELECTED:', picked.instanceID);
            }
        }
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



