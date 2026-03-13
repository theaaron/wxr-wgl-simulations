
import { loadStructure } from './rendering/loadStructure.js';
import { loadLabModel, renderLab, isLabLoaded } from './rendering/renderLab.js';
import {
    initVRControllers, setupControllerInput, updateControllers,
    getStructureModelMatrix, updateStructureManipulation,
    setPaceCallback, getLeftController, getRightController,
    renderControllerRays
} from './rendering/vrControllers.js';
import {
    initVRPanel, setPanelCallbacks, renderVRPanel, updatePanelHover
} from './rendering/vrPanel.js';
import { fetchWithProgress, initLoadingProgress } from './loadingProgress.js';
import { DEPTH_PEEL_VS, DEPTH_PEEL_FS } from './shaders.js';
import {
    initCardiacSimulation, stepSimulation, paceAt,
    isSimulationWorking, getVoltageTexture, getCompressedDimensions,
    getStepsPerFrame, resetSimulation
} from './simulation/cardiacCompute.js';

// ============================================================================
// UTILITIES
// ============================================================================
function compile(gl, src, type, name) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(`Shader (${name}):`, gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}
function mkProgram(gl, vs, fs, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, vs, gl.VERTEX_SHADER, name + ' VS'));
    gl.attachShader(p, compile(gl, fs, gl.FRAGMENT_SHADER, name + ' FS'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error(`Link (${name}):`, gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}

const mat4u = {
    create() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    perspective(o, fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2);
        o[0] = f / aspect; o[1] = o[2] = o[3] = 0; o[4] = 0; o[5] = f; o[6] = o[7] = 0;
        o[8] = o[9] = 0; o[10] = (far + near) / (near - far); o[11] = -1;
        o[12] = o[13] = 0; o[14] = (2 * far * near) / (near - far); o[15] = 0; return o;
    },
    lookAt(o, eye, ctr, up) {
        const zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
        let l = Math.sqrt(zx * zx + zy * zy + zz * zz);
        const z = [zx / l, zy / l, zz / l];
        const xx = up[1] * z[2] - up[2] * z[1], xy = up[2] * z[0] - up[0] * z[2], xz = up[0] * z[1] - up[1] * z[0];
        l = Math.sqrt(xx * xx + xy * xy + xz * xz);
        const x = [xx / l, xy / l, xz / l];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
        o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
        o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
        o[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
        o[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
        o[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
        o[15] = 1; return o;
    },
};

function normalMat(m) {
    const o = new Float32Array(16);
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3], m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11], m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
    const b00 = m00 * m11 - m01 * m10, b01 = m00 * m12 - m02 * m10, b02 = m00 * m13 - m03 * m10;
    const b03 = m01 * m12 - m02 * m11, b04 = m01 * m13 - m03 * m11, b05 = m02 * m13 - m03 * m12;
    const b06 = m20 * m31 - m21 * m30, b07 = m20 * m32 - m22 * m30, b08 = m20 * m33 - m23 * m30;
    const b09 = m21 * m32 - m22 * m31, b10 = m21 * m33 - m23 * m31, b11 = m22 * m33 - m23 * m32;
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!d) return o; d = 1 / d;
    o[0] = (m11 * b11 - m12 * b10 + m13 * b09) * d; o[1] = (m02 * b10 - m01 * b11 - m03 * b09) * d;
    o[2] = (m31 * b05 - m32 * b04 + m33 * b03) * d; o[3] = (m22 * b04 - m21 * b05 - m23 * b03) * d;
    o[4] = (m12 * b08 - m10 * b11 - m13 * b07) * d; o[5] = (m00 * b11 - m02 * b08 + m03 * b07) * d;
    o[6] = (m32 * b02 - m30 * b05 - m33 * b01) * d; o[7] = (m20 * b05 - m22 * b02 + m23 * b01) * d;
    o[8] = (m10 * b10 - m11 * b08 + m13 * b06) * d; o[9] = (m01 * b08 - m00 * b10 - m03 * b06) * d;
    o[10] = (m30 * b04 - m31 * b02 + m33 * b00) * d; o[11] = (m21 * b02 - m20 * b04 - m23 * b00) * d;
    o[12] = (m11 * b07 - m10 * b09 - m12 * b06) * d; o[13] = (m00 * b09 - m01 * b07 + m02 * b06) * d;
    o[14] = (m31 * b01 - m30 * b03 - m32 * b00) * d; o[15] = (m20 * b03 - m21 * b01 + m22 * b00) * d;
    let t;
    t = o[1]; o[1] = o[4]; o[4] = t; t = o[2]; o[2] = o[8]; o[8] = t;
    t = o[3]; o[3] = o[12]; o[12] = t; t = o[6]; o[6] = o[9]; o[9] = t;
    t = o[7]; o[7] = o[13]; o[13] = t; t = o[11]; o[11] = o[14]; o[14] = t;
    return o;
}

// ============================================================================
// GLOBALS
// ============================================================================
let gl = null;
let xrSession = null;
let xrReferenceSpace = null;
let peelProg = null;
let structure = null;

let posTex = null;
let normalTex = null;
let numVoxels = 0;
let texWidth = 0;
let texHeight = 0;

let VOXEL_SIZE = 5.0;
const ALPHA = 0.8;
const LIGHT_DIR = [-0.19, -0.21, -0.66];

let labModelMatrix = null;
let simRunning = false;

// ============================================================================
// NORMAL COMPUTATION
// ============================================================================
function computeNormals(struct) {
    const set = new Set(struct.voxels.map(v => `${v.x},${v.y},${v.z}`));
    const getU = (x, y, z) => set.has(`${x},${y},${z}`) ? 0 : 1;
    const grad = (vx, vy, vz, dx, dy, dz) => getU(vx + dx, vy + dy, vz + dz) - getU(vx - dx, vy - dy, vz - dz);
    const omega = 0.586, pw = 2 * omega + 1, sw = (1 - omega) / Math.sqrt(2);
    const normals = new Float32Array(numVoxels * 4);
    for (let i = 0; i < numVoxels; i++) {
        const { x, y, z } = struct.voxels[i];
        const dii = grad(x, y, z, 1, 0, 0), djj = grad(x, y, z, 0, 1, 0), dkk = grad(x, y, z, 0, 0, 1);
        const dij = grad(x, y, z, 0, 1, 1), dik = grad(x, y, z, 0, -1, 1);
        const dji = grad(x, y, z, 1, 0, 1), djk = grad(x, y, z, -1, 0, 1);
        const dki = grad(x, y, z, 1, 1, 0), dkj = grad(x, y, z, -1, 1, 0);
        let nx = pw * dii + sw * (dji + dki - djk - dkj);
        let ny = pw * djj + sw * (dij + dki - dik - dkj);
        let nz = pw * dkk + sw * (dij + dji - dik - djk);
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0.001) { nx /= len; ny /= len; nz /= len; }
        normals[i * 4] = nx; normals[i * 4 + 1] = ny; normals[i * 4 + 2] = nz; normals[i * 4 + 3] = len > 0.001 ? 1 : 0;
    }
    return normals;
}

// ============================================================================
// BUILD RENDERING TEXTURES
// ============================================================================
function buildRenderTextures(struct) {
    numVoxels = struct.voxels.length;
    texWidth = Math.ceil(Math.sqrt(numVoxels));
    texHeight = Math.ceil(numVoxels / texWidth);
    const { nx, ny, nz } = struct.dimensions;
    const maxDim = Math.max(nx, ny, nz);
    const posData = new Float32Array(texWidth * texHeight * 4);
    for (let i = 0; i < numVoxels; i++) {
        const v = struct.voxels[i];
        posData[i * 4] = v.x / maxDim;
        posData[i * 4 + 1] = v.y / maxDim;
        posData[i * 4 + 2] = v.z / maxDim;
        posData[i * 4 + 3] = 1.0;
    }
    const normalData = computeNormals(struct);
    const normalFull = new Float32Array(texWidth * texHeight * 4);
    normalFull.set(normalData);

    function mkPosTex(data) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texWidth, texHeight, 0, gl.RGBA, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }
    posTex = mkPosTex(posData);
    normalTex = mkPosTex(normalFull);
    console.log(`Render textures: ${numVoxels} voxels in ${texWidth}×${texHeight}`);
}

// ============================================================================
// DRAW VOXELS
// ============================================================================
function drawVoxels(projMatrix, viewMatrix, modelMatrix) {
    if (!peelProg || !posTex || numVoxels === 0) return;
    gl.useProgram(peelProg);

    const nm = normalMat(modelMatrix);

    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_modelMatrix'), false, modelMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_normalMatrix'), false, nm);

    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_noVoxels'), numVoxels);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_voxelSize'), VOXEL_SIZE);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_alpha'), ALPHA);

    gl.uniform4f(gl.getUniformLocation(peelProg, 'u_lightColor'), 1, 1, 1, 1);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_lightAmbientTerm'), 0.0);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_lightSpecularTerm'), 0.5);
    gl.uniform3fv(gl.getUniformLocation(peelProg, 'u_lightDirection'), LIGHT_DIR);
    gl.uniform4f(gl.getUniformLocation(peelProg, 'u_materialColor'), 0.9, 0.9, 0.9, 1);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_materialAmbientTerm'), 1.9);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_materialSpecularTerm'), 0.8);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_shininess'), 10.0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_posTex'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_normalTex'), 1);

    if (isSimulationWorking()) {
        const dims = getCompressedDimensions();
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, getVoltageTexture());
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_voltageTex'), 2);
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_compWidth'), dims.width);
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_useSimTex'), 1);
    } else {
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_useSimTex'), 0);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    gl.drawArrays(gl.TRIANGLES, 0, 36 * numVoxels);
    gl.disable(gl.CULL_FACE);
}

// ============================================================================
// INIT GL
// ============================================================================
function initGL() {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', { xrCompatible: true, antialias: true, alpha: false });
    if (!gl) { console.error('WebGL2 not available'); return false; }
    gl.getExtension('EXT_color_buffer_float');
    peelProg = mkProgram(gl, DEPTH_PEEL_VS, DEPTH_PEEL_FS, 'DepthPeel');
    if (!peelProg) return false;
    initVRControllers(gl);
    initVRPanel(gl);
    return true;
}

// ============================================================================
// LAB
// ============================================================================
function buildLabMatrix() {
    const s = 3.0;
    // Matches new-alpha-blend.js: Ry(270°)*Rx(90°), user stands inside lab at (-18,-4,16)
    labModelMatrix = new Float32Array([0, 0, s, 0, -s, 0, 0, 0, 0, -s, 0, 0, -18, -4, 16, 1]);
}

function buildDesktopLabMatrix() {
    // Same rotation as VR matrix, scaled down to fit desktop preview camera
    const s = 0.05;
    return new Float32Array([0, 0, s, 0, -s, 0, 0, 0, 0, -s, 0, 0, 0, 0, 0, 1]);
}

// ============================================================================
// VR FRAME
// ============================================================================
function onXRFrame(time, frame) {
    if (!xrSession) return;
    xrSession.requestAnimationFrame(onXRFrame);
    updateControllers(frame, xrReferenceSpace);
    updateStructureManipulation();

    if (simRunning) stepSimulation(getStepsPerFrame());

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;
    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const modelMatrix = getStructureModelMatrix();

    updatePanelHover(getLeftController(), getRightController());

    for (const view of pose.views) {
        const vp = glLayer.getViewport(view);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(vp.x, vp.y, vp.width, vp.height);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        drawVoxels(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix);
        if (isLabLoaded()) {
            if (!labModelMatrix) buildLabMatrix();
            gl.disable(gl.BLEND);
            gl.enable(gl.DEPTH_TEST);
            renderLab(gl, view.projectionMatrix, view.transform.inverse.matrix, labModelMatrix);
        }
        renderVRPanel(view.projectionMatrix, view.transform.inverse.matrix);
        renderControllerRays(gl, view.projectionMatrix, view.transform.inverse.matrix);
    }
    gl.disable(gl.SCISSOR_TEST);
}

// ============================================================================
// DESKTOP LOOP
// ============================================================================
function nonVRLoop() {
    requestAnimationFrame(nonVRLoop);
    if (xrSession || !structure) return;
    if (simRunning) stepSimulation(getStepsPerFrame());
    const canvas = gl.canvas;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.36, 0.23, 0.56, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4u.create();
    mat4u.perspective(proj, 0.44, canvas.width / canvas.height, 0.01, 100);
    const view = mat4u.create();
    mat4u.lookAt(view, [0, 0, 3], [0, 0, 0], [0, 1, 0]);
    if (isLabLoaded()) {
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        renderLab(gl, proj, view, buildDesktopLabMatrix());
    }
    drawVoxels(proj, view, getStructureModelMatrix());
}

// ============================================================================
// VR ENTRY
// ============================================================================
async function enterVR() {
    if (xrSession) { xrSession.end(); return; }
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['hand-tracking']
        });
        xrSession = session;
        setupControllerInput(session);
        session.addEventListener('end', () => {
            xrSession = null; xrReferenceSpace = null;
            document.getElementById('vr-button').textContent = 'Enter VR';
        });
        await gl.makeXRCompatible();
        await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
        xrReferenceSpace = await session.requestReferenceSpace('local');
        document.getElementById('vr-button').textContent = 'Exit VR';
        session.requestAnimationFrame(onXRFrame);
    } catch (e) {
        console.error('VR error:', e);
        document.getElementById('status').textContent = `VR error: ${e.message}`;
    }
}

// ============================================================================
// STARTUP
// ============================================================================
const STRUCTURE_PATHS = {
    whole: './resources/whole_64x64x64.json',
    atria: './resources/atria2.json',
    ventricle: './resources/ventricle_64x64x64.json',
};

window.addEventListener('load', async () => {
    const vrBtn    = document.getElementById('vr-button');
    const statusDiv = document.getElementById('status');

    if (!vrBtn || !statusDiv) return;

    initLoadingProgress(vrBtn, vrBtn.parentElement);

    const sel  = document.querySelector('input[name="structure"]:checked');
    const PATH = STRUCTURE_PATHS[sel?.value] || STRUCTURE_PATHS.whole;

    if (!initGL()) {
        statusDiv.textContent = 'WebGL2 init failed';
        return;
    }

    gl.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1';
    document.body.appendChild(gl.canvas);

    const slider = document.getElementById('voxel-scale');
    if (slider) {
        slider.value = VOXEL_SIZE;
        document.getElementById('scale-value').textContent = VOXEL_SIZE.toFixed(1);
        slider.addEventListener('input', e => {
            VOXEL_SIZE = parseFloat(e.target.value);
            document.getElementById('scale-value').textContent = VOXEL_SIZE.toFixed(1);
        });
    }

    const [structBuf, labBuf] = await Promise.all([
        fetchWithProgress('Heart structure', PATH).catch(e => {
            console.error('Failed to load structure:', e);
            return null;
        }),
        fetchWithProgress('Lab environment', './resources/cath-lab.glb').catch(e => {
            console.error('Failed to load lab model:', e);
            return null;
        }),
    ]);

    if (structBuf) {
        try {
            const json = JSON.parse(new TextDecoder().decode(structBuf));
            structure = await loadStructure(json);
            buildRenderTextures(structure);
            initCardiacSimulation(gl, structure);
            statusDiv.textContent = `${structure.voxels.length} voxels loaded`;

            let sumX = 0, sumY = 0, sumZ = 0;
            for (const v of structure.voxels) { sumX += v.x; sumY += v.y; sumZ += v.z; }
            const vn = structure.voxels.length;
            const cx = Math.round(sumX / vn), cy = Math.round(sumY / vn), cz = Math.round(sumZ / vn);

            const startSim = () => {
                simRunning = !simRunning;
                if (simRunning) paceAt(cx, cy, cz, 12);
            };
            setPanelCallbacks({
                startSimulation: startSim,
                resetView: () => { paceAt(cx, cy, cz, 12); },
            });
            setPaceCallback((x, y, z) => paceAt(x, y, z, 12));

        } catch (e) {
            console.error('Failed to process structure:', e);
            statusDiv.textContent = 'Structure load failed: ' + e.message;
        }
    }

    if (labBuf) {
        try {
            await loadLabModel(gl, labBuf);
            statusDiv.textContent = 'Lab model loaded';
        } catch (e) {
            console.error('Failed to load lab model:', e);
            statusDiv.textContent = 'Lab model failed, continuing without it';
        }
    }

    try {
        if (await navigator.xr?.isSessionSupported('immersive-vr')) {
            vrBtn.disabled = false;
            vrBtn.addEventListener('click', enterVR);
            statusDiv.textContent += ' — VR ready';
        }
    } catch (e) { console.error(e); }

    window.addEventListener('keydown', e => {
        if (!isSimulationWorking() || !structure) return;
        let sx = 0, sy = 0, sz = 0;
        for (const v of structure.voxels) { sx += v.x; sy += v.y; sz += v.z; }
        const vn = structure.voxels.length;
        const cx = Math.round(sx / vn), cy = Math.round(sy / vn), cz = Math.round(sz / vn);
        if (e.code === 'Space') {
            e.preventDefault();
            simRunning = !simRunning;
            if (simRunning) paceAt(cx, cy, cz, 12);
            console.log(simRunning ? '▶ Sim running' : '⏹ Sim stopped');
        } else if (e.code === 'KeyP') {
            paceAt(cx, cy, cz, 12);
            console.log(`⚡ Paced at centroid (${cx},${cy},${cz})`);
        } else if (e.code === 'KeyR') {
            resetSimulation();
            simRunning = false;
            console.log('🔄 Sim reset');
        }
    });

    nonVRLoop();
});
