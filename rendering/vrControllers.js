/**
 * VR Controller Input & Ray Visualization
 * Handles Quest controller input and renders pointer rays
 */

import { pickVoxel } from './renderStructure.js';

// Ray line geometry (simple line segment)
const RAY_LENGTH = 5.0; // meters
const RAY_COLOR = [0.5, 0.5, 0.5]; // Gray

// Controller state
let leftController = null;
let rightController = null;

// WebGL resources for ray rendering
let rayLineBuffer = null;
let rayProgram = null;

// ============================================================================
// RAY SHADERS
// ============================================================================

const RAY_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_rayMatrix; // Controller transform

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

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initVRControllers(gl) {
    console.log('🎮 Initializing VR controllers...');
    
    // Create ray line geometry (simple line from origin to RAY_LENGTH in -Z)
    const rayVertices = new Float32Array([
        0.0, 0.0, 0.0,           // Origin
        0.0, 0.0, -RAY_LENGTH    // End point (controllers point in -Z)
    ]);
    
    rayLineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rayLineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rayVertices, gl.STATIC_DRAW);
    
    // Compile ray shader
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

// ============================================================================
// CONTROLLER INPUT HANDLING
// ============================================================================

export function setupControllerInput(session) {
    console.log('🎮 Setting up controller input listeners...');
    
    session.addEventListener('select', onSelect);
    session.addEventListener('selectstart', onSelectStart);
    session.addEventListener('selectend', onSelectEnd);
    
    console.log('✅ Controller input listeners registered');
}

function onSelect(event) {
    console.log('🎮 Controller SELECT');
    
    const inputSource = event.inputSource;
    const frame = event.frame;
    
    if (inputSource.targetRayMode === 'tracked-pointer') {
        // Store which hand for next frame's ray picking
        if (inputSource.handedness === 'left') {
            if (leftController) {
                console.log('🎯 Left controller picked!');
                performGPUPick(leftController);
            }
        } else if (inputSource.handedness === 'right') {
            if (rightController) {
                console.log('🎯 Right controller picked!');
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

// ============================================================================
// GPU-BASED RAY PICKING
// ============================================================================

// GPU picking state (cached resources)
let pickingFBO = null;
let pickingTexture = null;
let pickingDepthBuffer = null;
let pickingPixelBuffer = null;
const PICK_RESOLUTION = 64; // Small resolution for picking render

function performGPUPick(controller) {
    // We'll use the existing pickVoxel system
    // But we need access to GL context, programs, buffers etc.
    // For now, we'll just store the pick request and handle it in the main render loop
    
    console.log('🎯 GPU pick requested at controller ray:', {
        origin: controller.origin,
        direction: controller.direction,
        handedness: controller.handedness
    });
    
    // Store pick request for processing
    if (controller.handedness === 'left') {
        window.leftControllerPickRequested = true;
    } else if (controller.handedness === 'right') {
        window.rightControllerPickRequested = true;
    }
}

/**
 * Perform GPU-based picking from controller's perspective
 * This should be called from the main render loop where we have all resources
 */
export function processControllerPick(gl, controller, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer) {
    if (!controller || !pickingProgram || !structure) return null;
    if (!positionBuffer || !instanceIDBuffer) {
        console.warn('⚠️ Pick failed: buffers not ready');
        return null;
    }
    
    // Initialize picking FBO if needed
    if (!pickingFBO) {
        initPickingFBO(gl);
    }
    
    // Build a projection matrix for the controller "camera"
    // Use a narrow FOV to pick at the ray center
    const pickProjMatrix = createPickProjectionMatrix(60); // 60 degree FOV
    
    // Controller matrix is already a view transform (world space to controller space)
    // But we need the inverse for view matrix (controller space to world space)
    const pickViewMatrix = invertMatrix(controller.matrix);
    
    // Render to picking FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickingFBO);
    gl.viewport(0, 0, PICK_RESOLUTION, PICK_RESOLUTION);
    gl.clearColor(1.0, 0.0, 1.0, 1.0); // Magenta for background
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Use picking program
    gl.useProgram(pickingProgram);
    
    // Set uniforms
    const projLoc = gl.getUniformLocation(pickingProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(pickingProgram, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(pickingProgram, 'u_modelMatrix');
    const scaleLoc = gl.getUniformLocation(pickingProgram, 'u_cubeScale');
    
    gl.uniformMatrix4fv(projLoc, false, pickProjMatrix);
    gl.uniformMatrix4fv(viewLoc, false, pickViewMatrix);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    gl.uniform1f(scaleLoc, 0.02); // Same as main render
    
    // Setup attributes from renderStructure
    const posLoc = gl.getAttribLocation(pickingProgram, 'a_position');
    const instPosLoc = gl.getAttribLocation(pickingProgram, 'a_instancePosition');
    const instIDLoc = gl.getAttribLocation(pickingProgram, 'a_instanceID');
    
    // Bind cube geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribDivisor(posLoc, 0);
    
    // Bind instance position
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    gl.vertexAttribDivisor(instPosLoc, 1);
    
    // Bind instance ID
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceIDBuffer);
    gl.vertexAttribPointer(instIDLoc, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instIDLoc);
    gl.vertexAttribDivisor(instIDLoc, 1);
    
    // Bind index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    // Draw all instances
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, structure.voxels.length);
    
    // Read center pixel
    const centerX = Math.floor(PICK_RESOLUTION / 2);
    const centerY = Math.floor(PICK_RESOLUTION / 2);
    
    if (!pickingPixelBuffer) {
        pickingPixelBuffer = new Uint8Array(4);
    }
    
    gl.readPixels(centerX, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickingPixelBuffer);
    
    // Restore main framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    // Decode ID
    const pixel = pickingPixelBuffer;
    
    // Check for background (magenta)
    if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255) {
        console.log('🎯 No voxel hit by controller ray');
        return null;
    }
    
    // Decode instance ID (R*65536 + G*256 + B)
    const instanceID = pixel[0] * 65536 + pixel[1] * 256 + pixel[2];
    
    if (instanceID >= structure.voxels.length) {
        console.warn('⚠️ Invalid pick ID:', instanceID);
        return null;
    }
    
    // Get voxel data
    const voxel = structure.voxels[instanceID];
    
    console.log('✅ CONTROLLER PICKED VOXEL:', {
        instanceID,
        gridCoords: [voxel.x, voxel.y, voxel.z],
        value: voxel.value,
        handedness: controller.handedness
    });
    
    return {
        instanceID,
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        value: voxel.value
    };
}

function initPickingFBO(gl) {
    // Create texture
    pickingTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pickingTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PICK_RESOLUTION, PICK_RESOLUTION, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    
    // Create depth buffer
    pickingDepthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, pickingDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, PICK_RESOLUTION, PICK_RESOLUTION);
    
    // Create FBO
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
    const aspect = 1.0; // Square picking texture
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
    // Simple 4x4 matrix inversion (assumes mat is a Float32Array or Array of 16 elements)
    // For controller transform, we can use a simpler approach since it's mostly rotation+translation
    
    const m = mat;
    const out = new Float32Array(16);
    
    // Extract rotation (top-left 3x3) and transpose it
    out[0] = m[0]; out[1] = m[4]; out[2] = m[8];  out[3] = 0;
    out[4] = m[1]; out[5] = m[5]; out[6] = m[9];  out[7] = 0;
    out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
    
    // Extract translation and negate it, then transform by transposed rotation
    const tx = -m[12];
    const ty = -m[13];
    const tz = -m[14];
    
    out[12] = tx * out[0] + ty * out[4] + tz * out[8];
    out[13] = tx * out[1] + ty * out[5] + tz * out[9];
    out[14] = tx * out[2] + ty * out[6] + tz * out[10];
    out[15] = 1;
    
    return out;
}

// ============================================================================
// CONTROLLER STATE UPDATE (Call every frame)
// ============================================================================

export function updateControllers(frame, referenceSpace) {
    if (!frame || !referenceSpace) return;
    
    // Update controller poses
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
                        x: -matrix[8],   // -Z axis is forward
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

// ============================================================================
// RAY VISUALIZATION RENDERING
// ============================================================================

export function renderControllerRays(gl, projectionMatrix, viewMatrix) {
    if (!rayProgram || !rayLineBuffer) return;
    
    gl.useProgram(rayProgram);
    
    // Get uniform locations
    const projLoc = gl.getUniformLocation(rayProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(rayProgram, 'u_viewMatrix');
    const rayMatrixLoc = gl.getUniformLocation(rayProgram, 'u_rayMatrix');
    const colorLoc = gl.getUniformLocation(rayProgram, 'u_rayColor');
    
    // Set uniforms
    gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniform3fv(colorLoc, RAY_COLOR);
    
    // Setup vertex attributes
    const posLoc = gl.getAttribLocation(rayProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, rayLineBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    // Disable depth test so rays always visible
    const depthTestWasEnabled = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    
    // Draw left controller ray
    if (leftController) {
        gl.uniformMatrix4fv(rayMatrixLoc, false, leftController.matrix);
        gl.drawArrays(gl.LINES, 0, 2);
    }
    
    // Draw right controller ray
    if (rightController) {
        gl.uniformMatrix4fv(rayMatrixLoc, false, rightController.matrix);
        gl.drawArrays(gl.LINES, 0, 2);
    }
    
    // Restore depth test state
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

export function checkAndProcessPicks(gl, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer) {
    // Check if left controller requested a pick
    if (window.leftControllerPickRequested && leftController) {
        window.leftControllerPickRequested = false;
        const picked = processControllerPick(gl, leftController, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer);
        
        if (picked) {
            // Import and use the existing picked voxels system
            if (window.addPickedVoxel) {
                window.addPickedVoxel(picked.instanceID);
            }
        }
    }
    
    // Check if right controller requested a pick
    if (window.rightControllerPickRequested && rightController) {
        window.rightControllerPickRequested = false;
        const picked = processControllerPick(gl, rightController, cubeBuffer, indexBuffer, modelMatrix, pickingProgram, structure, positionBuffer, instanceIDBuffer);
        
        if (picked) {
            // Import and use the existing picked voxels system
            if (window.addPickedVoxel) {
                window.addPickedVoxel(picked.instanceID);
            }
        }
    }
}

