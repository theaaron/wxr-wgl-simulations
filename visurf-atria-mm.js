import { loadStructure } from './rendering/loadStructure.js';
import { loadLabModel, renderLab, isLabLoaded } from './rendering/renderLab.js';
import {
    initVRControllers, setupControllerInput, updateControllers,
    getStructureModelMatrix, updateStructureManipulation,
    setPaceCallback, getLeftController, getRightController,
    renderControllerRays, setControllerHitDistances
} from './rendering/vrControllers.js';
import {
    initVRPanel, setPanelCallbacks, renderVRPanel, updatePanelHover,
    fingerPokePanel, updatePanelGrab, isPanelGrabbed, triggerPanelButton
} from './rendering/vrPanel.js';
import {
    updateHandTracking, getFingerRay,
    processFingerPanelPoke, consumeFingerPanelPoke, isHandPinching
} from './rendering/handTracking.js';
import { fetchWithProgress } from './loadingProgress.js';
import { SURF_VS, SURF_FS } from './shaders.js';
import { initHandRenderer, renderHands } from './rendering/renderHands.js';
import {
    initCardiacSimulation, stepSimulation, paceAt,
    isSimulationWorking, getVoltageTexture, getCompressedTexelIndexTexture,
    getCompressedDimensions, getStepsPerFrame, resetSimulation
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
    create() { const o = new Float32Array(16); o[0]=o[5]=o[10]=o[15]=1; return o; },
    perspective(o, fovy, aspect, near, far) {
        const f = 1/Math.tan(fovy/2);
        o[0]=f/aspect; o[1]=o[2]=o[3]=0; o[4]=0; o[5]=f; o[6]=o[7]=0;
        o[8]=o[9]=0; o[10]=(far+near)/(near-far); o[11]=-1;
        o[12]=o[13]=0; o[14]=(2*far*near)/(near-far); o[15]=0; return o;
    },
    lookAt(o, eye, ctr, up) {
        const zx=eye[0]-ctr[0], zy=eye[1]-ctr[1], zz=eye[2]-ctr[2];
        let l=Math.sqrt(zx*zx+zy*zy+zz*zz);
        const z=[zx/l,zy/l,zz/l];
        const xx=up[1]*z[2]-up[2]*z[1], xy=up[2]*z[0]-up[0]*z[2], xz=up[0]*z[1]-up[1]*z[0];
        l=Math.sqrt(xx*xx+xy*xy+xz*xz);
        const x=[xx/l,xy/l,xz/l];
        const y=[z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
        o[0]=x[0]; o[1]=y[0]; o[2]=z[0]; o[3]=0;
        o[4]=x[1]; o[5]=y[1]; o[6]=z[1]; o[7]=0;
        o[8]=x[2]; o[9]=y[2]; o[10]=z[2]; o[11]=0;
        o[12]=-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]);
        o[13]=-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]);
        o[14]=-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]);
        o[15]=1; return o;
    },
};

function normalMat(m) {
    const o = new Float32Array(16);
    const m00=m[0],m01=m[1],m02=m[2],m03=m[3],m10=m[4],m11=m[5],m12=m[6],m13=m[7];
    const m20=m[8],m21=m[9],m22=m[10],m23=m[11],m30=m[12],m31=m[13],m32=m[14],m33=m[15];
    const b00=m00*m11-m01*m10,b01=m00*m12-m02*m10,b02=m00*m13-m03*m10;
    const b03=m01*m12-m02*m11,b04=m01*m13-m03*m11,b05=m02*m13-m03*m12;
    const b06=m20*m31-m21*m30,b07=m20*m32-m22*m30,b08=m20*m33-m23*m30;
    const b09=m21*m32-m22*m31,b10=m21*m33-m23*m31,b11=m22*m33-m23*m32;
    let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!d) return o; d=1/d;
    o[0]=(m11*b11-m12*b10+m13*b09)*d; o[1]=(m02*b10-m01*b11-m03*b09)*d;
    o[2]=(m31*b05-m32*b04+m33*b03)*d; o[3]=(m22*b04-m21*b05-m23*b03)*d;
    o[4]=(m12*b08-m10*b11-m13*b07)*d; o[5]=(m00*b11-m02*b08+m03*b07)*d;
    o[6]=(m32*b02-m30*b05-m33*b01)*d; o[7]=(m20*b05-m22*b02+m23*b01)*d;
    o[8]=(m10*b10-m11*b08+m13*b06)*d; o[9]=(m01*b08-m00*b10-m03*b06)*d;
    o[10]=(m30*b04-m31*b02+m33*b00)*d; o[11]=(m21*b02-m20*b04-m23*b00)*d;
    o[12]=(m11*b07-m10*b09-m12*b06)*d; o[13]=(m00*b09-m01*b07+m02*b06)*d;
    o[14]=(m31*b01-m30*b03-m32*b00)*d; o[15]=(m20*b03-m21*b01+m22*b00)*d;
    let t;
    t=o[1];o[1]=o[4];o[4]=t; t=o[2];o[2]=o[8];o[8]=t;
    t=o[3];o[3]=o[12];o[12]=t; t=o[6];o[6]=o[9];o[9]=t;
    t=o[7];o[7]=o[13];o[13]=t; t=o[11];o[11]=o[14];o[14]=t;
    return o;
}

// ============================================================================
// GLOBALS
// ============================================================================
let gl = null;
let xrSession = null;
let xrReferenceSpace = null;
let surfProg = null;
let structure = null;

let posTex = null;
let normalTex = null;
let surfVAO = null;
let noNodes = 0;

const ALPHA = 0.8;
const LIGHT_DIR = [-0.19, -0.21, -0.66];

let labModelMatrix = null;
let simRunning = false;

// bounding sphere in model space, populated after structure loads
let surfBoundsCenter = [0, 0, 0];
let surfBoundsRadius = 1.5;

let cutX = 1.0, cutY = 1.0, cutZ = 1.0;
const CUT_STEP = 0.1;
function stepCut(axis) {
    if (axis === 'x') cutX = cutX <= CUT_STEP + 0.001 ? 1.0 : cutX - CUT_STEP;
    else if (axis === 'y') cutY = cutY <= CUT_STEP + 0.001 ? 1.0 : cutY - CUT_STEP;
    else if (axis === 'z') cutZ = cutZ <= CUT_STEP + 0.001 ? 1.0 : cutZ - CUT_STEP;
}

// ============================================================================
// NORMAL COMPUTATION
// ============================================================================
function computeNormals(struct) {
    const set = new Set(struct.voxels.map(v => `${v.x},${v.y},${v.z}`));
    const getU = (x, y, z) => set.has(`${x},${y},${z}`) ? 0 : 1;
    const grad = (vx, vy, vz, dx, dy, dz) => getU(vx+dx, vy+dy, vz+dz) - getU(vx-dx, vy-dy, vz-dz);
    const omega = 0.586, pw = 2*omega+1, sw = (1-omega)/Math.sqrt(2);
    const { compWidth: cw, compHeight: ch } = struct.metadata;
    const normals = new Float32Array(cw * ch * 4);
    for (let i = 0; i < struct.voxels.length; i++) {
        const { x, y, z } = struct.voxels[i];
        const dii=grad(x,y,z,1,0,0), djj=grad(x,y,z,0,1,0), dkk=grad(x,y,z,0,0,1);
        const dij=grad(x,y,z,0,1,1), dik=grad(x,y,z,0,-1,1);
        const dji=grad(x,y,z,1,0,1), djk=grad(x,y,z,-1,0,1);
        const dki=grad(x,y,z,1,1,0), dkj=grad(x,y,z,-1,1,0);
        let nx = pw*dii + sw*(dji+dki-djk-dkj);
        let ny = pw*djj + sw*(dij+dki-dik-dkj);
        let nz = pw*dkk + sw*(dij+dji-dik-djk);
        const len = Math.sqrt(nx*nx+ny*ny+nz*nz);
        if (len > 0.001) { nx/=len; ny/=len; nz/=len; }
        normals[i*4]=nx; normals[i*4+1]=ny; normals[i*4+2]=nz; normals[i*4+3]=len>0.001?1:0;
    }
    return normals;
}

// ============================================================================
// BUILD SURFACE BUFFERS
// ============================================================================
function buildSurfaceBuffers(struct) {
    const { compWidth: cw, compHeight: ch } = struct.metadata;
    const { nx, ny, nz } = struct.dimensions;
    const maxDim = Math.max(nx, ny, nz);

    // position texture: (vox.x/maxDim, vox.y/maxDim, voz.z/maxDim, 1.0)
    const posData = new Float32Array(cw * ch * 4);
    for (let i = 0; i < struct.voxels.length; i++) {
        const v = struct.voxels[i];
        posData[i*4]   = v.x / maxDim;
        posData[i*4+1] = v.y / maxDim;
        posData[i*4+2] = v.z / maxDim;
        posData[i*4+3] = 1.0;
    }
    posTex = mkF32Tex(cw, ch, posData);

    const normalData = computeNormals(struct);
    normalTex = mkF32Tex(cw, ch, normalData);

    const bf = struct.raw.boundaryFacets;
    noNodes = bf.noNodes;
    surfVAO = gl.createVertexArray();
    gl.bindVertexArray(surfVAO);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bf.indices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // compute bounding sphere in model space (positions are (v/maxDim - 0.5)*2 in the shader)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of struct.voxels) {
        const px = (v.x / maxDim - 0.5) * 2;
        const py = (v.y / maxDim - 0.5) * 2;
        const pz = (v.z / maxDim - 0.5) * 2;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    surfBoundsCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const hr = [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2];
    surfBoundsRadius = Math.sqrt(hr[0]*hr[0] + hr[1]*hr[1] + hr[2]*hr[2]);

    console.log(`Surface buffers: ${noNodes} vertices (${bf.noTriangles} triangles)`);
}

// ============================================================================
// RAY-SPHERE INTERSECTION
// ============================================================================
function raySphereHit(origin, dir, center, radius) {
    const lx = origin.x - center[0];
    const ly = origin.y - center[1];
    const lz = origin.z - center[2];
    const b  = lx * dir.x + ly * dir.y + lz * dir.z;
    const c  = lx*lx + ly*ly + lz*lz - radius*radius;
    const disc = b*b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0.001 ? t : null;
}

function updateSurfaceHitDistances(modelMatrix) {
    // transform bounding sphere center to world space
    const [bx, by, bz] = surfBoundsCenter;
    const wx = modelMatrix[0]*bx + modelMatrix[4]*by + modelMatrix[8]*bz + modelMatrix[12];
    const wy = modelMatrix[1]*bx + modelMatrix[5]*by + modelMatrix[9]*bz + modelMatrix[13];
    const wz = modelMatrix[2]*bx + modelMatrix[6]*by + modelMatrix[10]*bz + modelMatrix[14];
    // scale factor = magnitude of first column
    const scale = Math.sqrt(modelMatrix[0]**2 + modelMatrix[1]**2 + modelMatrix[2]**2);
    const worldCenter = [wx, wy, wz];
    const worldRadius = surfBoundsRadius * scale;

    const L = getLeftController();
    const R = getRightController();
    const leftDist  = (L && !L.isHand) ? raySphereHit(L.origin, L.direction, worldCenter, worldRadius) : null;
    const rightDist = (R && !R.isHand) ? raySphereHit(R.origin, R.direction, worldCenter, worldRadius) : null;
    setControllerHitDistances(leftDist, rightDist);
}

function mkF32Tex(w, h, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}

// ============================================================================
// DRAW SURFACE
// ============================================================================
function drawSurface(projMatrix, viewMatrix, modelMatrix) {
    if (!surfProg || !surfVAO || noNodes === 0) return;
    gl.useProgram(surfProg);

    const nm = normalMat(modelMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(surfProg, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(surfProg, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(surfProg, 'u_modelMatrix'), false, modelMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(surfProg, 'u_normalMatrix'), false, nm);

    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_cutX'), cutX);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_cutY'), cutY);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_cutZ'), cutZ);

    gl.uniform4f(gl.getUniformLocation(surfProg, 'u_lightColor'), 1, 1, 1, 1);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_lightAmbientTerm'), 0.15);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_lightSpecularTerm'), 0.5);
    gl.uniform3fv(gl.getUniformLocation(surfProg, 'u_lightDirection'), LIGHT_DIR);
    gl.uniform4f(gl.getUniformLocation(surfProg, 'u_materialColor'), 0.9, 0.9, 0.9, 1);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_materialAmbientTerm'), 1.0);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_materialSpecularTerm'), 0.8);
    gl.uniform1f(gl.getUniformLocation(surfProg, 'u_shininess'), 12.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.uniform1i(gl.getUniformLocation(surfProg, 'u_posTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.uniform1i(gl.getUniformLocation(surfProg, 'u_normalTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, getCompressedTexelIndexTexture());
    gl.uniform1i(gl.getUniformLocation(surfProg, 'u_compressedTexelIndex'), 2);

    const simOn = isSimulationWorking();
    gl.uniform1i(gl.getUniformLocation(surfProg, 'u_useSimTex'), simOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, simOn ? getVoltageTexture() : posTex);
    gl.uniform1i(gl.getUniformLocation(surfProg, 'u_voltageTex'), 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(surfVAO);
    gl.drawArrays(gl.TRIANGLES, 0, noNodes);
    gl.bindVertexArray(null);
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
    surfProg = mkProgram(gl, SURF_VS, SURF_FS, 'Surface');
    if (!surfProg) return false;
    initVRControllers(gl);
    initVRPanel(gl);
    initHandRenderer(gl);
    return true;
}

// ============================================================================
// LAB
// ============================================================================
function buildLabMatrix() {
    const s = 3.0;
    labModelMatrix = new Float32Array([0, 0, s, 0, -s, 0, 0, 0, 0, -s, 0, 0, -18, -4, 16, 1]);
}
function buildDesktopLabMatrix() {
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
    updateHandTracking(frame, xrReferenceSpace);

    const leftCtrl  = getLeftController();
    const rightCtrl = getRightController();

    updatePanelHover(leftCtrl, rightCtrl);
    updatePanelGrab(
        leftCtrl, rightCtrl,
        false, false,
        isHandPinching('left'), isHandPinching('right')
    );

    if (!isPanelGrabbed()) updateStructureManipulation();

    // finger poke panel buttons
    for (const hand of ['left', 'right']) {
        const fingerRay = getFingerRay(hand);
        if (fingerRay) {
            const buttonId = fingerPokePanel(fingerRay.origin);
            processFingerPanelPoke(hand, buttonId);
            if (consumeFingerPanelPoke(hand) && buttonId) {
                triggerPanelButton(buttonId);
            }
        }
    }

    if (simRunning) stepSimulation(getStepsPerFrame());

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;
    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const modelMatrix = getStructureModelMatrix();
    if (structure) updateSurfaceHitDistances(modelMatrix);

    for (const view of pose.views) {
        const vp = glLayer.getViewport(view);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(vp.x, vp.y, vp.width, vp.height);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        drawSurface(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix);
        if (isLabLoaded()) {
            if (!labModelMatrix) buildLabMatrix();
            gl.disable(gl.BLEND);
            gl.enable(gl.DEPTH_TEST);
            renderLab(gl, view.projectionMatrix, view.transform.inverse.matrix, labModelMatrix);
        }
        renderVRPanel(view.projectionMatrix, view.transform.inverse.matrix);
        renderControllerRays(gl, view.projectionMatrix, view.transform.inverse.matrix);
        renderHands(gl, frame, xrReferenceSpace, view.projectionMatrix, view.transform.inverse.matrix);
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
    gl.clearColor(0.10, 0.10, 0.18, 1.0);
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
    drawSurface(proj, view, getStructureModelMatrix());
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
const ATRIA_PATHS = {
    small: './resources/atria.json',
    // large: './resources/atria2.json',
    large: 'https://pi9k1iia1f4aeulw.public.blob.vercel-storage.com/13-350um-192x192x192_lra_grid.json',
};

window.addEventListener('load', () => {
    const vrBtn    = document.getElementById('vr-button');
    const statusDiv = document.getElementById('status');
    if (!vrBtn || !statusDiv) return;

    if (!initGL()) {
        statusDiv.textContent = 'WebGL2 init failed';
        return;
    }

    gl.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1';
    document.body.appendChild(gl.canvas);

    statusDiv.textContent = 'Ready';

    // load lab model in background — doesn't block VR entry
    const LAB_URL = 'https://pi9k1iia1f4aeulw.public.blob.vercel-storage.com/cath-lab.glb';
    fetchWithProgress('Lab environment', LAB_URL)
        .then(buf => loadLabModel(gl, buf))
        .catch(e => console.warn('Lab model unavailable:', e));

    vrBtn.addEventListener('click', async () => {
        if (xrSession) { xrSession.end(); return; }

        if (!structure) {
            vrBtn.disabled = true;
            vrBtn.textContent = 'Loading…';

            const sizeBtn = document.querySelector('.sel-btn[data-size].active');
            const PATH = ATRIA_PATHS[sizeBtn?.dataset.size] ?? ATRIA_PATHS.small;

            try {
                const structBuf = await fetchWithProgress('Heart structure', PATH);
                const json = JSON.parse(new TextDecoder().decode(structBuf));
                structure = await loadStructure(json);
                buildSurfaceBuffers(structure);
                initCardiacSimulation(gl, structure);

                let sumX = 0, sumY = 0, sumZ = 0;
                for (const v of structure.voxels) { sumX += v.x; sumY += v.y; sumZ += v.z; }
                const vn = structure.voxels.length;
                const cx = Math.round(sumX / vn), cy = Math.round(sumY / vn), cz = Math.round(sumZ / vn);

                setPanelCallbacks({
                    startSimulation: () => { simRunning = !simRunning; if (simRunning) paceAt(cx, cy, cz, 12); },
                    resetView:       () => paceAt(cx, cy, cz, 12),
                    cutX: () => stepCut('x'),
                    cutY: () => stepCut('y'),
                    cutZ: () => stepCut('z'),
                });
                setPaceCallback((x, y, z) => paceAt(x, y, z, 12));

                window.addEventListener('keydown', e => {
                    if (!structure) return;
                    let sx = 0, sy = 0, sz = 0;
                    for (const v of structure.voxels) { sx += v.x; sy += v.y; sz += v.z; }
                    const n = structure.voxels.length;
                    const kx = Math.round(sx/n), ky = Math.round(sy/n), kz = Math.round(sz/n);
                    if (e.code === 'Space') { e.preventDefault(); simRunning = !simRunning; if (simRunning && isSimulationWorking()) paceAt(kx, ky, kz, 12); }
                    else if (e.code === 'KeyP') { if (isSimulationWorking()) paceAt(kx, ky, kz, 12); }
                    else if (e.code === 'KeyR') { resetSimulation(); simRunning = false; }
                });
            } catch (e) {
                console.error('Failed to load structure:', e);
                statusDiv.textContent = 'Load failed: ' + e.message;
                vrBtn.disabled = false;
                vrBtn.textContent = 'Enter VR';
                return;
            }

            vrBtn.disabled = false;
            vrBtn.textContent = 'Enter VR';
        }

        enterVR();
    });

    nonVRLoop();
});
