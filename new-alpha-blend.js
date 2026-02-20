import { cubeSize, indices, vertices } from "./cube.js";
import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS, SIMPLE_FS, SIMPLE_VS, PICKER_VS_SIMPLE, PICKER_FS } from "./shaders.js";
import { renderStructure, pickVoxel, clearPickedVoxels, addPickedVoxel, getPositionBuffer, getInstanceIDBuffer, getStructure, setVoltageColors } from "./rendering/renderStructure.js";
import { renderCubes } from "./rendering/renderCubes.js";
import { renderTestPlanes } from "./rendering/renderTestPlanes.js";
import { drawHelix } from "./rendering/drawHelix.js";
import { drawDNAHelix } from "./rendering/drawDNAHelix.js";
import { drawHelixCubes } from "./rendering/drawHelixCubes.js";
import { initVRControllers, setupControllerInput, updateControllers, renderControllerRays, checkAndProcessPicks, updateStructureManipulation, getStructureModelMatrix, resetStructureTransform, setPaceCallback, getLeftController, getRightController } from "./rendering/vrControllers.js";
import { initVRPanel, setPanelCallbacks, updatePanelHover, renderVRPanel, triggerPanelButton, isHoveringPanel } from "./rendering/vrPanel.js";
import { initCardiacSimulation, stepSimulation, paceAt, isInitialized as isSimInitialized, isRunning, setRunning, readVoltageData, getStepsPerFrame, isSimulationWorking } from "./simulation/cardiacCompute.js";
import { voltageToColors, buildVoxelToTexelMap } from "./simulation/colormap.js";
import { loadLabModel, renderLab, isLabLoaded } from "./rendering/renderLab.js";
import { updateHandTracking } from "./rendering/handTracking.js";

// simple mat4 utility for non-VR rendering
const mat4 = {
    create: function () {
        const out = new Float32Array(16);
        out[0] = out[5] = out[10] = out[15] = 1;
        return out;
    },
    perspective: function (out, fovy, aspect, near, far) {
        const f = 1.0 / Math.tan(fovy / 2);
        out[0] = f / aspect;
        out[1] = out[2] = out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = out[7] = 0;
        out[8] = out[9] = 0;
        out[10] = (far + near) / (near - far);
        out[11] = -1;
        out[12] = out[13] = 0;
        out[14] = (2 * far * near) / (near - far);
        out[15] = 0;
        return out;
    },
    lookAt: function (out, eye, center, up) {
        const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
        let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
        const z = [zx / len, zy / len, zz / len];
        const xx = up[1] * z[2] - up[2] * z[1];
        const xy = up[2] * z[0] - up[0] * z[2];
        const xz = up[0] * z[1] - up[1] * z[0];
        len = Math.sqrt(xx * xx + xy * xy + xz * xz);
        const x = [xx / len, xy / len, xz / len];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
        out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
        out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
        out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
        out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
        out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
        out[15] = 1;
        return out;
    }
};

// export const PATH = './resources/13-350um-192x192x192_lra_grid.json';
// export const PATH = './resources/atria_64x64x64.json';

export const PATH = 'https://pi9k1iia1f4aeulw.public.blob.vercel-storage.com/13-350um-192x192x192_lra_grid.json';
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function compileShader(gl, source, type, debugName = '') {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`Shader compile error (${debugName}):`, gl.getShaderInfoLog(shader));
        console.error('Shader source:', source.substring(0, 300));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource, debugName = '') {
    const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER, `${debugName} VS`);
    const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER, `${debugName} FS`);
    if (!vertexShader || !fragmentShader) {
        console.error(`Failed to compile shaders for ${debugName}`);
        return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`Program link error (${debugName}):`, gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function createTexture(gl, width, height, format, type) {
    width = Math.floor(width);
    height = Math.floor(height);

    // WebGL 2.0: Use sized internal formats
    let internalFormat = format;
    if (format === gl.RGBA) {
        if (type === gl.UNSIGNED_BYTE) {
            internalFormat = gl.RGBA8;
        } else if (type === gl.FLOAT) {
            internalFormat = gl.RGBA32F;
        }
    } else if (format === gl.RGB) {
        if (type === gl.UNSIGNED_BYTE) {
            internalFormat = gl.RGB8;
        } else if (type === gl.FLOAT) {
            internalFormat = gl.RGB32F;
        }
    } else if (format === gl.DEPTH_COMPONENT) {
        internalFormat = gl.DEPTH_COMPONENT24;
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    texture.width = width;
    texture.height = height;

    return texture;
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let gl = null;
let xrSession = null;
let xrReferenceSpace = null;

let simpleProgram = null;
let pickingProgram = null;

let cubeBuffer = null;

// cardiac simulation state
let simulationInitialized = false;
let voxelToTexelMap = null;
let simulationRunning = false;
let cubeColorBuffer = null;
let indexBuffer = null;
let instanceBuffer = null;
let instanceCount = 0;
let quadBuffer = null;

// NEW: Plane geometry buffers
let planeVertexBuffer = null;
let planeIndexBuffer = null;
let planeColorBuffers = [];

let drawBuffersExt = null;
let instancingExt = null;

let approxProgram = null;
let approxCompositeProgram = null;

let leftEyeApproxTextures = {
    accumTexture: null,
    revealTexture: null,
    framebuffer: null
};

let rightEyeApproxTextures = {
    accumTexture: null,
    revealTexture: null,
    framebuffer: null
};

const ALPHA = 0.5;
let vrButton = null;
let statusDiv = null;

function updateStatus(message) {
    console.log(message);
    if (statusDiv) {
        statusDiv.textContent = message;
    }
}
// simple program


// end simple program

// ============================================================================
// INITIALIZATION
// ============================================================================

function initGL() {
    const canvas = document.createElement('canvas');

    gl = canvas.getContext('webgl2', {
        xrCompatible: true,
        antialias: false,
        alpha: false
    });

    if (!gl) {
        updateStatus('Failed to get WebGL 2.0 context');
        return false;
    }

    // enable float texture rendering for simulation ping-pong buffers
    const floatBufferExt = gl.getExtension('EXT_color_buffer_float');
    if (!floatBufferExt) {
        console.warn('EXT_color_buffer_float not available - simulation may not work');
    }

    console.log('WebGL 2.0 context created');

    initVRControllers(gl);
    initVRPanel(gl);

    // expose addPickedVoxel to window for VR controller integration
    window.addPickedVoxel = addPickedVoxel;

    instancingExt = {
        drawElementsInstancedANGLE: (mode, count, type, offset, primcount) => {
            gl.drawElementsInstanced(mode, count, type, offset, primcount);
        },
        drawArraysInstancedANGLE: (mode, first, count, primcount) => {
            gl.drawArraysInstanced(mode, first, count, primcount);
        },
        vertexAttribDivisorANGLE: (index, divisor) => {
            gl.vertexAttribDivisor(index, divisor);
        }
    };

    drawBuffersExt = {
        COLOR_ATTACHMENT0_WEBGL: gl.COLOR_ATTACHMENT0,
        COLOR_ATTACHMENT1_WEBGL: gl.COLOR_ATTACHMENT1,
        drawBuffersWEBGL: (buffers) => {
            gl.drawBuffers(buffers);
        }
    };

    simpleProgram = createProgram(gl, SIMPLE_VS, SIMPLE_FS, 'Simple');
    if (!simpleProgram) {
        updateStatus('Failed to create fallback shader program');
        return false;
    }

    pickingProgram = createProgram(gl, PICKER_VS_SIMPLE, PICKER_FS, 'Picking');
    if (!pickingProgram) {
        console.error('Failed to create picking shader program');
    }

    if (drawBuffersExt) {
        approxProgram = createProgram(gl, APPROX_VS, APPROX_FS, 'Approx');
        approxCompositeProgram = createProgram(gl, APPROX_COMPOSITE_VS, APPROX_COMPOSITE_FS, 'ApproxComposite');

        if (approxProgram && approxCompositeProgram) {
            updateStatus('Approximate alpha blending available');
        } else {
            updateStatus('Failed to create approx programs - using fallback');
            drawBuffersExt = null;
        }
    }

    cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const maxInstances = 1000;
    const instancePositions = new Float32Array(maxInstances * 3);
    const instanceColors = new Float32Array(maxInstances * 3);
    let idx = 0;

    const colorPalette = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ];

    for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
            for (let z = 0; z < 10; z++) {
                const dx = x - 4.5, dy = y - 4.5, dz = z - 4.5;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < 5 * 5) {
                    instancePositions[idx] = x * cubeSize;
                    instancePositions[idx + 1] = y * cubeSize;
                    instancePositions[idx + 2] = z * cubeSize - 3;

                    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
                    instanceColors[idx] = color[0];
                    instanceColors[idx + 1] = color[1];
                    instanceColors[idx + 2] = color[2];

                    idx += 3;
                }
            }
        }
    }

    instanceCount = idx / 3;


    instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instancePositions.subarray(0, idx), gl.STATIC_DRAW);

    cubeColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceColors.subarray(0, idx), gl.STATIC_DRAW);

    const planeSize = 0.5;
    const planeVertices = new Float32Array([
        -planeSize, -planeSize, 0.0,
        planeSize, -planeSize, 0.0,
        planeSize, planeSize, 0.0,
        -planeSize, planeSize, 0.0
    ]);

    const planeIndices = new Uint16Array([
        0, 1, 2,
        0, 2, 3
    ]);

    planeVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, planeVertices, gl.STATIC_DRAW);

    planeIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, planeIndices, gl.STATIC_DRAW);

    const planeColors = [
        new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
        new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
    ];

    for (let i = 0; i < planeColors.length; i++) {
        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, planeColors[i], gl.STATIC_DRAW);
        planeColorBuffers.push(colorBuffer);
    }

    const quadVertices = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1
    ]);

    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    updateStatus('WebGL initialized with approximate alpha blending');
    return true;
}

// ============================================================================
// APPROXIMATE BLENDING SETUP
// ============================================================================

function createApproxFramebuffer(gl, accumTexture, revealTexture) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
        gl.TEXTURE_2D,
        accumTexture,
        0
    );

    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        drawBuffersExt.COLOR_ATTACHMENT1_WEBGL,
        gl.TEXTURE_2D,
        revealTexture,
        0
    );

    const depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16,
        accumTexture.width, accumTexture.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER, depthBuffer);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
        return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
}

function setupApproxTextures(textureSet, width, height) {
    if (textureSet.framebuffer) {
        gl.deleteTexture(textureSet.accumTexture);
        gl.deleteTexture(textureSet.revealTexture);
        gl.deleteFramebuffer(textureSet.framebuffer);
    }

    textureSet.accumTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
    textureSet.revealTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);

    textureSet.framebuffer = createApproxFramebuffer(
        gl,
        textureSet.accumTexture,
        textureSet.revealTexture
    );
}

// ============================================================================
// RENDERING
// ============================================================================
// moved everything to separate files, see imports

// ============================================================================
// XR FUNCTIONS
// ============================================================================

function drawSceneWithApproxBlending(view) {
    const goOpaque = false;
    const viewport = xrSession.renderState.baseLayer.getViewport(view);
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const x = Math.floor(viewport.x);
    const y = Math.floor(viewport.y);

    if (width <= 0 || height <= 0) return;

    // determine which eye based on viewport x position (left eye is x=0)
    const isLeftEye = x === 0;
    const textureSet = isLeftEye ? leftEyeApproxTextures : rightEyeApproxTextures;

    // debug: log every 60 frames
    if (!drawSceneWithApproxBlending.frameCount) drawSceneWithApproxBlending.frameCount = 0;
    drawSceneWithApproxBlending.frameCount++;
    if (drawSceneWithApproxBlending.frameCount % 60 === 0) {
        // logging every 60 frames: console.log(`${isLeftEye ? 'LEFT' : 'RIGHT'} eye (view.eye="${view.eye}"): viewport(${x}, ${y}, ${width}x${height})`);
    }

    const modelMatrix = getStructureModelMatrix();

    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);

    const program = simpleProgram || approxProgram;

    // save matrices for picking (use first/left eye matrices)
    if (!window.lastProjMatrix || isLeftEye) {
        window.lastProjMatrix = view.projectionMatrix;
        window.lastViewMatrix = view.transform.inverse.matrix;
    }

    renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, PATH, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, program);

    gl.disable(gl.SCISSOR_TEST);
    if (goOpaque) {
        return;
    }

    // if MRT extension not available, render opaquely only
    if (!drawBuffersExt) {
        if (!drawSceneWithApproxBlending.warnedOnce) {
            console.warn('MRT extension not available, rendering opaque only');
            drawSceneWithApproxBlending.warnedOnce = true;
        }
        return;
    }

    const needsRecreation = !textureSet.accumTexture ||
        textureSet.accumTexture.width !== width ||
        textureSet.accumTexture.height !== height;

    if (needsRecreation) {
        setupApproxTextures(textureSet, width, height);
    }

    // === RENDER TO OFFSCREEN FRAMEBUFFER ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffer);
    gl.viewport(0, 0, width, height);

    drawBuffersExt.drawBuffersWEBGL([
        drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
        drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
    ]);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    gl.blendFunc(gl.ONE, gl.ONE);

    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.useProgram(approxProgram);
    const alphaLoc = gl.getUniformLocation(approxProgram, 'u_alpha');

    if (!drawSceneWithApproxBlending.loggedAlpha) {
        drawSceneWithApproxBlending.loggedAlpha = true;
    }

    gl.uniform1f(alphaLoc, ALPHA);

    if (!window.lastProjMatrix || isLeftEye) {
        window.lastProjMatrix = view.projectionMatrix;
        window.lastViewMatrix = view.transform.inverse.matrix;
    }

    renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, PATH, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, approxProgram);
    // drawDNAHelix(gl, instancingExt, 2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelixCubes(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, 100, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelix(gl, instancingExt, 2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderTestPlanes(gl, instancingExt, planeVertexBuffer, planeIndexBuffer, planeColorBuffers, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderCubes(gl, instancingExt, cubeBuffer, indexBuffer, instanceBuffer, cubeColorBuffer, instanceCount, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, approxProgram);


    // === COMPOSITE PASS ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);

    // don't clear - composite over the opaque pass we already rendered

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);

    gl.useProgram(approxCompositeProgram);

    const accumLoc = gl.getUniformLocation(approxCompositeProgram, 'u_accumTexture');
    const revealLoc = gl.getUniformLocation(approxCompositeProgram, 'u_revealTexture');

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.accumTexture);
    gl.uniform1i(accumLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.revealTexture);
    gl.uniform1i(revealLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const posLoc = gl.getAttribLocation(approxCompositeProgram, 'a_position');
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Draw lab AFTER composite; user is inside the lab (origin at center), scale so room encloses you
    if (isLabLoaded()) {
        const labModelMatrix = mat4.create();
        const labScale = 3.0;
        // Ry(270°) * Rx(90°): cos270=0, sin270=-1
        labModelMatrix[0] = 0; labModelMatrix[1] = 0; labModelMatrix[2] = labScale; labModelMatrix[3] = 0;
        labModelMatrix[4] = -labScale; labModelMatrix[5] = 0; labModelMatrix[6] = 0; labModelMatrix[7] = 0;
        labModelMatrix[8] = 0; labModelMatrix[9] = -labScale; labModelMatrix[10] = 0; labModelMatrix[11] = 0;
        labModelMatrix[12] = -18; labModelMatrix[13] = -4; labModelMatrix[14] = 16; labModelMatrix[15] = 1.0;

        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        renderLab(gl, view.projectionMatrix, view.transform.inverse.matrix, labModelMatrix);
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
}

function onXRFrame(time, frame) {
    if (!xrSession) return;

    if (!onXRFrame.frameCount) onXRFrame.frameCount = 0;
    onXRFrame.frameCount++;

    xrSession.requestAnimationFrame(onXRFrame);

    updateControllers(frame, xrReferenceSpace);
    updateHandTracking(frame, xrReferenceSpace);
    updateStructureManipulation();

    // update panel hover state
    updatePanelHover(getLeftController(), getRightController());

    // process any pending controller picks
    const structure = getStructure();
    if (pickingProgram && structure) {
        checkAndProcessPicks(
            gl,
            cubeBuffer,
            indexBuffer,
            getStructureModelMatrix(),
            pickingProgram,
            structure,
            getPositionBuffer(),
            getInstanceIDBuffer()
        );
    }

    // initialize simulation once structure is loaded
    if (structure && !simulationInitialized) {
        try {
            initCardiacSimulation(gl, structure);
            voxelToTexelMap = buildVoxelToTexelMap(structure);
            simulationInitialized = true;

            // set up VR pacing callback
            setPaceCallback((x, y, z) => {
                paceAt(x, y, z, 8);
            });

            // set up VR panel callbacks
            setPanelCallbacks({
                startSimulation: () => {
                    const struct = getStructure();
                    if (!struct) return;

                    let paceX, paceY, paceZ;

                    if (window.lastPickedVoxel) {
                        paceX = window.lastPickedVoxel.x;
                        paceY = window.lastPickedVoxel.y;
                        paceZ = window.lastPickedVoxel.z;
                        console.log(`Panel: Starting at picked voxel (${paceX}, ${paceY}, ${paceZ})`);
                    } else {
                        // pick a random voxel
                        const voxels = struct.voxels;
                        const randomIndex = Math.floor(Math.random() * voxels.length);
                        const randomVoxel = voxels[randomIndex];
                        paceX = randomVoxel.x;
                        paceY = randomVoxel.y;
                        paceZ = randomVoxel.z;
                        console.log(`Panel: Starting at random voxel #${randomIndex} (${paceX}, ${paceY}, ${paceZ})`);
                    }

                    setRunning(true);
                    simulationRunning = true;
                    paceAt(paceX, paceY, paceZ, 10);
                },
                pauseSimulation: () => {
                    simulationRunning = !simulationRunning;
                    setRunning(simulationRunning);
                    console.log(`Panel: Simulation ${simulationRunning ? 'resumed' : 'paused'}`);
                },
                resetView: () => {
                    resetStructureTransform();
                    console.log('Panel: View reset');
                }
            });

            console.log('Cardiac simulation initialized in XR frame');
        } catch (e) {
            console.error('Failed to initialize simulation:', e);
            simulationInitialized = true; // prevent retry spam
        }
    }

    // run simulation steps and update colors (only if FBOs work)
    if (simulationInitialized && isSimulationWorking() && simulationRunning) {
        stepSimulation(getStepsPerFrame());

        // update voltage colors
        if (structure && voxelToTexelMap) {
            const voltageData = readVoltageData();
            if (voltageData) {
                const colors = voltageToColors(voltageData, structure.voxels.length, voxelToTexelMap);
                setVoltageColors(colors);
            }
        }
    }

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;

    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);

    // clear the ENTIRE framebuffer (both eyes) once at the start
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);


    for (const view of pose.views) {
        drawSceneWithApproxBlending(view);

        // render controller rays after scene (so they appear on top)
        const viewport = glLayer.getViewport(view);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        renderControllerRays(gl, view.projectionMatrix, view.transform.inverse.matrix);

        // render VR control panel
        renderVRPanel(view.projectionMatrix, view.transform.inverse.matrix);
    }
}

async function enterVR() {
    if (xrSession) {
        xrSession.end();
        return;
    }

    try {
        updateStatus('Requesting VR session...');

        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['hand-tracking']
        });
        xrSession = session;

        setupControllerInput(session);

        updateStatus('VR session started');
        vrButton.textContent = 'Exit VR';

        session.addEventListener('end', () => {
            updateStatus('VR session ended');
            xrSession = null;
            xrReferenceSpace = null;
            vrButton.textContent = 'Enter VR';
        });

        await gl.makeXRCompatible();

        const xrLayer = new XRWebGLLayer(session, gl);
        await session.updateRenderState({ baseLayer: xrLayer });

        xrReferenceSpace = await session.requestReferenceSpace('local');
        updateStatus('Transparent cubes + test planes rendering with approximate alpha blending');

        session.requestAnimationFrame(onXRFrame);

    } catch (error) {
        updateStatus(`VR Error: ${error.message}`);
        console.error('VR session error:', error);
        if (xrSession) {
            xrSession.end();
            xrSession = null;
        }
    }
}

// ============================================================================
// STARTUP
// ============================================================================

window.addEventListener('load', async () => {
    vrButton = document.getElementById('vr-button');
    statusDiv = document.getElementById('status');

    if (!vrButton || !statusDiv) {
        updateStatus('Missing HTML elements');
        return;
    }

    // voxel scale slider for proper size of the cubes. probably no longer needed. 
    const scaleSlider = document.getElementById('voxel-scale');
    const scaleValue = document.getElementById('scale-value');
    if (scaleSlider && scaleValue) {
        renderStructure.voxelScale = parseFloat(scaleSlider.value);
        scaleSlider.addEventListener('input', (e) => {
            renderStructure.voxelScale = parseFloat(e.target.value);
            scaleValue.textContent = parseFloat(e.target.value).toFixed(1);
        });
    }

    if (!initGL()) {
        updateStatus('WebGL initialization failed');
        return;
    }

    // Load lab model
    try {
        const glbPath = 'https://pi9k1iia1f4aeulw.public.blob.vercel-storage.com/cath-lab.glb';
        // const glbPath = './resources/cath-lab.glb';
        await loadLabModel(gl, glbPath);
        updateStatus('Lab model loaded');
    } catch (error) {
        console.error('Failed to load lab model:', error);
        updateStatus('Lab model failed to load, continuing without it');
    }

    if (!navigator.xr) {
        updateStatus('WebXR not supported');
        return;
    }

    try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
            updateStatus('VR supported - click Enter VR');
            vrButton.disabled = false;
            vrButton.addEventListener('click', enterVR);
        } else {
            updateStatus('VR not supported on this device');
        }
    } catch (error) {
        updateStatus(`Error checking VR support: ${error.message}`);
    }

    // ========================================================================
    // MOUSE PICKING FOR DESKTOP TESTING
    // ========================================================================

    const canvas = gl.canvas;

    // mouse click handler for picking
    canvas.addEventListener('click', (event) => {
        if (!pickingProgram) {
            console.warn('Picking program not available');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // scale mouse coordinates to actual canvas resolution
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const scaledMouseX = mouseX * scaleX;
        const scaledMouseY = mouseY * scaleY;

        const projMatrix = window.lastProjMatrix || mat4.create();
        const viewMatrix = window.lastViewMatrix || mat4.create();
        const modelMatrix = getStructureModelMatrix();

        const picked = pickVoxel(
            gl,
            instancingExt,
            cubeBuffer,
            indexBuffer,
            scaledMouseX,
            scaledMouseY,
            projMatrix,
            viewMatrix,
            modelMatrix,
            pickingProgram,
            canvas
        );

        if (picked) {
            console.log(`Picked voxel #${picked.instanceID} at (${picked.x}, ${picked.y}, ${picked.z})`);
            // store for pacing
            window.lastPickedVoxel = { x: picked.x, y: picked.y, z: picked.z };
        }
    });

    // hold shift to continuously select voxels
    canvas.addEventListener('mousemove', (event) => {
        if (event.shiftKey && pickingProgram) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const scaledMouseX = mouseX * scaleX;
            const scaledMouseY = mouseY * scaleY;

            const projMatrix = window.lastProjMatrix || mat4.create();
            const viewMatrix = window.lastViewMatrix || mat4.create();
            const modelMatrix = getStructureModelMatrix();

            const picked = pickVoxel(
                gl,
                instancingExt,
                cubeBuffer,
                indexBuffer,
                scaledMouseX,
                scaledMouseY,
                projMatrix,
                viewMatrix,
                modelMatrix,
                pickingProgram,
                canvas
            );

            canvas.style.cursor = picked ? 'pointer' : 'default';
        } else {
            canvas.style.cursor = 'default';
        }
    });


    window.addEventListener('keydown', (event) => {

        if (event.key === 'c' && !event.ctrlKey && !event.metaKey) {
            clearPickedVoxels();
        }
        if (event.key === 'r' && !event.ctrlKey && !event.metaKey) {
            resetStructureTransform();
            console.log('Structure transform reset');
        }
        // simulation controls
        if (event.key === ' ' && !event.ctrlKey && !event.metaKey) {
            simulationRunning = !simulationRunning;
            setRunning(simulationRunning);
            console.log(simulationRunning ? 'Simulation running' : 'Simulation paused');
        }
        if (event.key === 'p' && !event.ctrlKey && !event.metaKey) {
            if (simulationInitialized) {
                // pace at last picked voxel, or center if none picked
                if (window.lastPickedVoxel) {
                    const { x, y, z } = window.lastPickedVoxel;
                    console.log(`Pacing at picked voxel (${x}, ${y}, ${z})`);
                    paceAt(x, y, z, 10);
                } else {
                    // fallback: pace at center of mass
                    const structure = getStructure();
                    if (structure) {
                        const voxels = structure.voxels;
                        let sumX = 0, sumY = 0, sumZ = 0;
                        for (const v of voxels) {
                            sumX += v.x;
                            sumY += v.y;
                            sumZ += v.z;
                        }
                        const cx = Math.floor(sumX / voxels.length);
                        const cy = Math.floor(sumY / voxels.length);
                        const cz = Math.floor(sumZ / voxels.length);
                        console.log(`No voxel picked, pacing at center (${cx}, ${cy}, ${cz})`);
                        paceAt(cx, cy, cz, 10);
                    }
                }
            }
        }
    });

    window.clearPickedVoxels = clearPickedVoxels;

    console.log('Controls: click=pick, SPACE=start/stop, p=pace at picked voxel, c=clear, r=reset');

    // non-VR render loop for desktop testing
    function nonVRLoop() {
        requestAnimationFrame(nonVRLoop);

        // skip if XR session is active
        if (xrSession) return;

        const structure = getStructure();

        // initialize simulation once structure is loaded
        if (structure && !simulationInitialized) {
            try {
                initCardiacSimulation(gl, structure);
                voxelToTexelMap = buildVoxelToTexelMap(structure);
                simulationInitialized = true;
                console.log('Cardiac simulation initialized in non-VR mode');
            } catch (e) {
                console.error('Failed to initialize simulation:', e);
                simulationInitialized = true;
            }
        }

        // run simulation and update colors
        if (simulationInitialized && isSimulationWorking() && simulationRunning) {
            stepSimulation(getStepsPerFrame());

            if (structure && voxelToTexelMap) {
                const voltageData = readVoltageData();
                if (voltageData) {
                    const colors = voltageToColors(voltageData, structure.voxels.length, voxelToTexelMap);
                    setVoltageColors(colors);
                }
            }
        }

        // simple 2D render for desktop preview
        if (structure) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            gl.clearColor(1.0, 1.0, 1.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            // create simple view/proj matrices for non-VR viewing
            const aspect = gl.canvas.width / gl.canvas.height;
            const projMatrix = mat4.create();
            mat4.perspective(projMatrix, Math.PI / 4, aspect, 0.1, 100);

            const viewMatrix = mat4.create();
            mat4.lookAt(viewMatrix, [0, 0, 4], [0, 0, 0], [0, 1, 0]);

            // store for picking
            window.lastProjMatrix = projMatrix;
            window.lastViewMatrix = viewMatrix;

            const modelMatrix = getStructureModelMatrix();

            // render with simple program (no approximate blending needed for non-VR)
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);

            renderStructure(
                gl,
                instancingExt,
                simpleProgram,
                cubeBuffer,
                indexBuffer,
                viewMatrix,
                projMatrix,
                modelMatrix
            );
        }
    }

    nonVRLoop();
});