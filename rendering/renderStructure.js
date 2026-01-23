import { PATH } from '../new-alpha-blend.js';
import { loadStructure } from './loadStructure.js';

// voltage coloring support
let voltageColors = null;

export function setVoltageColors(colors) {
    voltageColors = colors;
}

export function clearVoltageColors() {
    voltageColors = null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col*4+row] = a[row]*b[col*4] + a[4+row]*b[col*4+1] + a[8+row]*b[col*4+2] + a[12+row]*b[col*4+3];
        }
    }
    return out;
}

function invertMat4(m) {
    const out = new Float32Array(16);
    const m00=m[0], m01=m[1], m02=m[2], m03=m[3];
    const m10=m[4], m11=m[5], m12=m[6], m13=m[7];
    const m20=m[8], m21=m[9], m22=m[10], m23=m[11];
    const m30=m[12], m31=m[13], m32=m[14], m33=m[15];
    
    const b00 = m00*m11 - m01*m10, b01 = m00*m12 - m02*m10;
    const b02 = m00*m13 - m03*m10, b03 = m01*m12 - m02*m11;
    const b04 = m01*m13 - m03*m11, b05 = m02*m13 - m03*m12;
    const b06 = m20*m31 - m21*m30, b07 = m20*m32 - m22*m30;
    const b08 = m20*m33 - m23*m30, b09 = m21*m32 - m22*m31;
    const b10 = m21*m33 - m23*m31, b11 = m22*m33 - m23*m32;
    
    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return out;
    det = 1.0 / det;
    
    out[0]  = (m11*b11 - m12*b10 + m13*b09) * det;
    out[1]  = (m02*b10 - m01*b11 - m03*b09) * det;
    out[2]  = (m31*b05 - m32*b04 + m33*b03) * det;
    out[3]  = (m22*b04 - m21*b05 - m23*b03) * det;
    out[4]  = (m12*b08 - m10*b11 - m13*b07) * det;
    out[5]  = (m00*b11 - m02*b08 + m03*b07) * det;
    out[6]  = (m32*b02 - m30*b05 - m33*b01) * det;
    out[7]  = (m20*b05 - m22*b02 + m23*b01) * det;
    out[8]  = (m10*b10 - m11*b08 + m13*b06) * det;
    out[9]  = (m01*b08 - m00*b10 - m03*b06) * det;
    out[10] = (m30*b04 - m31*b02 + m33*b00) * det;
    out[11] = (m21*b02 - m20*b04 - m23*b00) * det;
    out[12] = (m11*b07 - m10*b09 - m12*b06) * det;
    out[13] = (m00*b09 - m01*b07 + m02*b06) * det;
    out[14] = (m31*b01 - m30*b03 - m32*b00) * det;
    out[15] = (m20*b03 - m21*b01 + m22*b00) * det;
    return out;
}

function transposeMat4(m) {
    let t;
    t = m[1]; m[1] = m[4]; m[4] = t;
    t = m[2]; m[2] = m[8]; m[8] = t;
    t = m[3]; m[3] = m[12]; m[12] = t;
    t = m[6]; m[6] = m[9]; m[9] = t;
    t = m[7]; m[7] = m[13]; m[13] = t;
    t = m[11]; m[11] = m[14]; m[14] = t;
}

const pickedVoxels = new Set();

export function addPickedVoxel(instanceID) {
    pickedVoxels.add(instanceID);
    console.log(`✅ Added voxel ${instanceID} to picked set`);
}

// getters for buffers (for VR controller picking)
export function getPositionBuffer() {
    return renderStructure.positionBuffer;
}

export function getInstanceIDBuffer() {
    return renderStructure.instanceIDBuffer;
}

export function getStructure() {
    return renderStructure.cachedStructure;
}

function createInstanceDataTexture(gl, structure) {
    const numVoxels = structure.voxels.length;
    
    // calculate texture dimensions (square texture)
    const width = Math.ceil(Math.sqrt(numVoxels));
    const height = Math.ceil(numVoxels / width);
    
    console.log(`Creating instance data texture: ${width}x${height} for ${numVoxels} voxels`);
    
    // rgba float data: stores (x, y, z, value) for each instance
    const data = new Float32Array(width * height * 4);
    
    for (let i = 0; i < numVoxels; i++) {
        const voxel = structure.voxels[i];
        data[i * 4 + 0] = voxel.x;
        data[i * 4 + 1] = voxel.y;
        data[i * 4 + 2] = voxel.z;
        data[i * 4 + 3] = voxel.value;
    }
    
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0,
                  gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    return { texture, width, height };
}

function createInstanceIDBuffer(gl, numInstances) {
    // create buffer with instance IDs (0, 1, 2, ..., numInstances-1)
    const data = new Float32Array(numInstances);
    for (let i = 0; i < numInstances; i++) {
        data[i] = i;
    }
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    
    console.log(`Created instance ID buffer: ${numInstances} IDs`);
    console.log(`First 10 IDs:`, Array.from(data.slice(0, 10)));
    console.log(`Last 10 IDs:`, Array.from(data.slice(-10)));
    
    return buffer;
}

function createPositionBuffer(gl, structure) {
    const centerX = structure.dimensions.nx / 2;
    const centerY = structure.dimensions.ny / 2;
    const centerZ = structure.dimensions.nz / 2;
    
    // create position data centered at origin
    const positions = new Float32Array(structure.voxels.length * 3);
    for (let i = 0; i < structure.voxels.length; i++) {
        const voxel = structure.voxels[i];
        positions[i * 3 + 0] = voxel.x - centerX;
        positions[i * 3 + 1] = voxel.y - centerY;
        positions[i * 3 + 2] = voxel.z - centerZ;
    }
    
    // Create and populate buffer
    renderStructure.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    // Also create color buffer (will be populated on first render)
    renderStructure.colorBuffer = gl.createBuffer();
    
    console.log(`Created position buffer: ${structure.voxels.length} voxels, centered at (${centerX}, ${centerY}, ${centerZ})`);
}

function computeSurfaceNormals(structure) {
    const numVoxels = structure.voxels.length;
    
    // build lookup set for fast neighbor checking
    const voxelSet = new Set();
    for (const voxel of structure.voxels) {
        voxelSet.add(`${voxel.x},${voxel.y},${voxel.z}`);
    }
    
    // returns 1 if empty (outside domain), 0 if solid
    const getU = (x, y, z) => voxelSet.has(`${x},${y},${z}`) ? 0 : 1;
    
    // gradient: forward - backward (like Abubu's firstDerivative)
    const gradient = (vx, vy, vz, dx, dy, dz) => {
        return getU(vx + dx, vy + dy, vz + dz) - getU(vx - dx, vy - dy, vz - dz);
    };
    
    // Abubu weighting factor
    const omega = 0.586;
    const primaryWeight = 2 * omega + 1;
    const secondaryWeight = (1 - omega) / Math.sqrt(2);
    
    const normals = new Float32Array(numVoxels * 3);
    
    for (let i = 0; i < numVoxels; i++) {
        const v = structure.voxels[i];
        
        // primary directions (6 neighbors)
        const dii = gradient(v.x, v.y, v.z, 1, 0, 0);
        const djj = gradient(v.x, v.y, v.z, 0, 1, 0);
        const dkk = gradient(v.x, v.y, v.z, 0, 0, 1);
        
        // secondary/diagonal directions (6 more)
        const dij = gradient(v.x, v.y, v.z, 0, 1, 1);   // jj+kk
        const dik = gradient(v.x, v.y, v.z, 0, -1, 1);  // kk-jj
        const dji = gradient(v.x, v.y, v.z, 1, 0, 1);   // ii+kk
        const djk = gradient(v.x, v.y, v.z, -1, 0, 1);  // kk-ii
        const dki = gradient(v.x, v.y, v.z, 1, 1, 0);   // ii+jj
        const dkj = gradient(v.x, v.y, v.z, -1, 1, 0);  // jj-ii
        
        // weighted combination (matching Abubu's formula)
        let nx = primaryWeight * dii + secondaryWeight * (dji + dki - djk - dkj);
        let ny = primaryWeight * djj + secondaryWeight * (dij + dki - dik - dkj);
        let nz = primaryWeight * dkk + secondaryWeight * (dij + dji - dik - djk);
        
        // normalize
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0.001) {
            normals[i * 3 + 0] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            // interior voxel, use default up normal
            normals[i * 3 + 0] = 0;
            normals[i * 3 + 1] = 1;
            normals[i * 3 + 2] = 0;
        }
    }
    
    console.log(`Computed surface normals (Abubu-style) for ${numVoxels} voxels`);
    return normals;
}

function createNormalBuffer(gl, structure) {
    const normals = computeSurfaceNormals(structure);
    
    renderStructure.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    
    // store for later use
    renderStructure.surfaceNormals = normals;
    
    console.log(`Created normal buffer: ${normals.length / 3} normals`);
    console.log(`First 5 normals:`, Array.from(normals.slice(0, 15)));
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

export async function renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, path, projMatrix, viewMatrix, modelMatrix, program) {

    // start loading if not already loading or loaded
    if (!renderStructure.cachedStructure && !renderStructure.loading) {
        path = PATH
        console.log('Starting structure load...');
        renderStructure.loading = loadStructure(path).then(struct => {
            renderStructure.cachedStructure = struct;
            renderStructure.loading = null;
            console.log(`Loaded ${struct.voxels.length} voxels`);
            console.log(`Grid dimensions: ${struct.dimensions.nx}×${struct.dimensions.ny}×${struct.dimensions.nz}`);
            console.log(`Sample voxels:`, struct.voxels.slice(0, 5));
            console.log(`First voxel coords: x=${struct.voxels[0].x}, y=${struct.voxels[0].y}, z=${struct.voxels[0].z}`);
            console.log(`Second voxel coords: x=${struct.voxels[1].x}, y=${struct.voxels[1].y}, z=${struct.voxels[1].z}`);
            console.log(`Rendering ${struct.voxels.length} cube instances`);
            
            // create instance data texture and buffers for picking
            renderStructure.instanceDataTexture = createInstanceDataTexture(gl, struct);
            renderStructure.instanceIDBuffer = createInstanceIDBuffer(gl, struct.voxels.length);
            
            // create position buffer immediately for VR controller picking
            createPositionBuffer(gl, struct);
            
            // compute and store surface normals
            createNormalBuffer(gl, struct);
            
            console.log('✅ Instance data texture, ID buffer, position buffer, and normal buffer created');
        }).catch(error => {
            console.error('Failed to load structure:', error);
            renderStructure.loading = null;
        });
    }
    
    // if still loading, return early - don't block the render loop
    const structure = renderStructure.cachedStructure;
    if (!structure) {
        return; // data not ready yet, try again next frame
    }
    const numCubes = structure.voxels.length;
    
    if (numCubes === 0) {
        console.warn('No voxels to render');
        return;
    }
    
    if (!renderStructure.frameCounter) {
        renderStructure.frameCounter = 0;
        renderStructure.callsThisFrame = 0;
    }
    renderStructure.callsThisFrame++;
    if (Date.now() - (renderStructure.lastLog || 0) > 5000) {
        console.log(`Render calls per frame: ${renderStructure.callsThisFrame}. Rendering ${numCubes}/${structure.voxels.length} voxels`);
        renderStructure.lastLog = Date.now();
        renderStructure.callsThisFrame = 0;
    }

    gl.useProgram(program);

    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    // phong: get lighting uniform locations
    const lightDirLoc = gl.getUniformLocation(program, 'u_lightDirection');
    const lightColorLoc = gl.getUniformLocation(program, 'u_lightColor');
    const lightAmbientLoc = gl.getUniformLocation(program, 'u_lightAmbient');
    const lightSpecularLoc = gl.getUniformLocation(program, 'u_lightSpecular');
    const matAmbientLoc = gl.getUniformLocation(program, 'u_materialAmbient');
    const matSpecularLoc = gl.getUniformLocation(program, 'u_materialSpecular');
    const shininessLoc = gl.getUniformLocation(program, 'u_shininess');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    

    // lighting to match Abubu DeepVoxelizer style (default: [0.6, 0.25, -0.66])
    if (lightDirLoc !== null) gl.uniform3f(lightDirLoc, 0.6, 0.25, -0.66);
    if (lightColorLoc !== null) gl.uniform3f(lightColorLoc, 1.0, 1.0, 1.0);
    if (lightAmbientLoc !== null) gl.uniform3f(lightAmbientLoc, 0.0, 0.0, 0.0);  // no ambient for dramatic shadows
    if (lightSpecularLoc !== null) gl.uniform3f(lightSpecularLoc, 0.5, 0.5, 0.5);
    if (matAmbientLoc !== null) gl.uniform3f(matAmbientLoc, 1.0, 1.0, 1.0);
    if (matSpecularLoc !== null) gl.uniform3f(matSpecularLoc, 0.5, 0.5, 0.5);
    if (shininessLoc !== null) gl.uniform1f(shininessLoc, 10.0);
    

    const globalScale = 0.02; 
    const zScale = renderStructure.zScale || 1.0;
    const baseMatrix = new Float32Array([
        globalScale, 0, 0, 0,      
        0, globalScale, 0, 0,      
        0, 0, globalScale * zScale, 0,
        0, 0, -1, 1     
    ]);
    const finalMatrix = multiplyMat4(modelMatrix, baseMatrix);
    gl.uniformMatrix4fv(modelLoc, false, finalMatrix);
    
    // compute normalMatrix = inverse(transpose(viewMatrix * modelMatrix))
    const normalMatrixLoc = gl.getUniformLocation(program, 'u_normalMatrix');
    if (normalMatrixLoc !== null) {
        const modelView = multiplyMat4(viewMatrix, finalMatrix);
        const normalMatrix = invertMat4(modelView);
        transposeMat4(normalMatrix);
        gl.uniformMatrix4fv(normalMatrixLoc, false, normalMatrix);
    }
    

    const voxelSize = renderStructure.voxelScale || 5.0;
    // expose voxelScale for vr controller picking
    window.renderStructureVoxelScale = voxelSize;
    
    const cubeScaleLoc = gl.getUniformLocation(program, 'u_cubeScale');
    if (cubeScaleLoc !== null) {
        gl.uniform1f(cubeScaleLoc, voxelSize);
    }
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, ALPHA); 
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const structurePositions = new Float32Array(numCubes * 3);
    const structureColors = new Float32Array(numCubes * 3);
    
    const centerX = structure.dimensions.nx / 2;
    const centerY = structure.dimensions.ny / 2;
    const centerZ = structure.dimensions.nz / 2;
    
    for (let i = 0; i < numCubes; i++) {
        const voxel = structure.voxels[i];
        
        structurePositions[i * 3] = voxel.x - centerX;
        structurePositions[i * 3 + 1] = voxel.y - centerY;
        structurePositions[i * 3 + 2] = voxel.z - centerZ;
        
        // check if this voxel has been picked - if so, make it red
        if (pickedVoxels.has(i)) {
            structureColors[i * 3] = 1.0;     // R
            structureColors[i * 3 + 1] = 0.0; // G
            structureColors[i * 3 + 2] = 0.0; // B
        } else if (voltageColors && voltageColors.length >= (i + 1) * 3) {
            // use voltage colors from simulation
            structureColors[i * 3] = voltageColors[i * 3];
            structureColors[i * 3 + 1] = voltageColors[i * 3 + 1];
            structureColors[i * 3 + 2] = voltageColors[i * 3 + 2];
        } else {
            // default color: light gray (matches resting state in colormap)
            structureColors[i * 3] = 0.85;
            structureColors[i * 3 + 1] = 0.85;
            structureColors[i * 3 + 2] = 0.85;
        }
    }
    
    // this is just to log the first few pos/cols for debugging
    if (!renderStructure.loggedPositions) {
        console.log('First 5 voxel positions:', structurePositions.slice(0, 15));
        console.log('Center offsets:', { centerX, centerY, centerZ });
        console.log('Buffer size:', structurePositions.length, 'floats for', numCubes, 'cubes');
        renderStructure.loggedPositions = true;
    }
    
    if (!renderStructure.positionBuffer) {
        renderStructure.positionBuffer = gl.createBuffer();
        renderStructure.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, structurePositions, gl.DYNAMIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, structureColors, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    const instNormalLoc = gl.getAttribLocation(program, 'a_instanceNormal');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);  
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1); 
    
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.colorBuffer);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
        instancingExt.vertexAttribDivisorANGLE(colorLoc, 1);  
    }
    
    // bind instance normals for smooth surface lighting
    if (instNormalLoc >= 0 && renderStructure.normalBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.normalBuffer);
        gl.vertexAttribPointer(instNormalLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(instNormalLoc);
        instancingExt.vertexAttribDivisorANGLE(instNormalLoc, 1);
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36,  
        gl.UNSIGNED_SHORT, 
        0, 
        numCubes
    );

}

// ============================================================================
// PICKING FUNCTION
// ============================================================================

export function pickVoxel(gl, instancingExt, cubeBuffer, indexBuffer, mouseX, mouseY, 
                          projMatrix, viewMatrix, modelMatrix, pickingProgram, canvas) {
    
    const structure = renderStructure.cachedStructure;
    if (!structure) {
        console.warn('⚠️ Cannot pick: structure not loaded yet');
        return null;
    }
    
    // initialize picking fbo if needed
    if (!renderStructure.pickingFBO) {
        renderStructure.pickingFBO = gl.createFramebuffer();
        
        renderStructure.pickingTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, renderStructure.pickingTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 
                      canvas.width, canvas.height, 0,
                      gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        
        renderStructure.pickingDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderStructure.pickingDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 
                              canvas.width, canvas.height);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderStructure.pickingFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, 
                               gl.TEXTURE_2D, renderStructure.pickingTexture, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, 
                                  gl.RENDERBUFFER, renderStructure.pickingDepth);
        
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('❌ Picking framebuffer incomplete:', status);
            return null;
        }
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        console.log('✅ Picking FBO initialized');
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderStructure.pickingFBO);
    gl.viewport(0, 0, canvas.width, canvas.height);
    
    // debug: clear to bright magenta to verify fbo is being used
    gl.clearColor(1, 0, 1, 1);  // Magenta = (255, 0, 255)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    
    if (!pickVoxel.loggedFBOSetup) {
        console.log('🎯 Picking FBO render starting...');
        console.log(`   Viewport: ${canvas.width}×${canvas.height}`);
        console.log(`   Picking program pointer: ${pickingProgram}`);
        pickVoxel.loggedFBOSetup = true;
    }
    
    gl.useProgram(pickingProgram);
    
    // verify the program is being used
    const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    console.log(`   Current program: ${currentProgram}, Picking program: ${pickingProgram}, Match: ${currentProgram === pickingProgram}`);
    if (currentProgram !== pickingProgram) {
        console.error(`   Program mismatch! Picking shader is NOT active!`);
        return null;
    }
    
    const projLoc = gl.getUniformLocation(pickingProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(pickingProgram, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(pickingProgram, 'u_modelMatrix');
    const cubeScaleLoc = gl.getUniformLocation(pickingProgram, 'u_cubeScale');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    const globalScale = 0.02;
    const zScale = renderStructure.zScale || 1.0;
    const baseMatrix = new Float32Array([
        globalScale, 0, 0, 0,
        0, globalScale, 0, 0,
        0, 0, globalScale * zScale, 0,
        0, 0, -1, 1
    ]);
    const finalMatrix = multiplyMat4(modelMatrix, baseMatrix);
    gl.uniformMatrix4fv(modelLoc, false, finalMatrix);
    
    const voxelSize = renderStructure.voxelScale || 5.0;
    if (cubeScaleLoc !== null) {
        gl.uniform1f(cubeScaleLoc, voxelSize);
    }
    
    // set up vert attributes
    const posLoc = gl.getAttribLocation(pickingProgram, 'a_position');
    const instPosLoc = gl.getAttribLocation(pickingProgram, 'a_instancePosition');
    const instIDLoc = gl.getAttribLocation(pickingProgram, 'a_instanceID');
    
    // Debug logging (only first time)
    if (!pickVoxel.loggedAttributes) {
        console.log('Picking attribute locations:');
        console.log(`  a_position: ${posLoc}`);
        console.log(`  a_instancePosition: ${instPosLoc}`);
        console.log(`  a_instanceID: ${instIDLoc}`);
        pickVoxel.loggedAttributes = true;
    }
    
    if (!cubeBuffer) {
        console.error('❌ Cube buffer is null!');
        return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);
    
    if (!pickVoxel.loggedGeometry) {
        const bufferSize = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
        console.log(`   Cube buffer size: ${bufferSize} bytes`);
        pickVoxel.loggedGeometry = true;
    }
    
    // instance positions - must be populated first
    if (!renderStructure.positionBuffer) {
        console.error('❌ Position buffer not created yet! Need to render scene first.');
        console.log('   Creating position buffer now from structure data...');
        
        const centerX = structure.dimensions.nx / 2;
        const centerY = structure.dimensions.ny / 2;
        const centerZ = structure.dimensions.nz / 2;
        
        const positions = new Float32Array(structure.voxels.length * 3);
        for (let i = 0; i < structure.voxels.length; i++) {
            const voxel = structure.voxels[i];
            positions[i * 3] = voxel.x - centerX;
            positions[i * 3 + 1] = voxel.y - centerY;
            positions[i * 3 + 2] = voxel.z - centerZ;
        }
        
        renderStructure.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        
        console.log(`   ✅ Created position buffer with ${structure.voxels.length} voxels`);
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);
    
    // instance ids
    if (!renderStructure.instanceIDBuffer) {
        console.error('❌ Instance ID buffer not created yet!');
        return null;
    }
    if (instIDLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.instanceIDBuffer);
        gl.vertexAttribPointer(instIDLoc, 1, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(instIDLoc);
        instancingExt.vertexAttribDivisorANGLE(instIDLoc, 1);
    } else {
        console.error('❌ a_instanceID attribute not found in picking shader!');
    }
    
    if (!indexBuffer) {
        console.error('❌ Index buffer is null!');
        return null;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    const numCubes = structure.voxels.length;
    
    // Final check before draw
    const preDrawProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    console.log(`   About to draw ${numCubes} cubes with program: ${preDrawProgram}`);
    
    // Check for GL errors before draw
    const preDrawError = gl.getError();
    if (preDrawError !== gl.NO_ERROR) {
        console.error(`   ❌ GL error before draw: ${preDrawError}`);
    }
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES,
        36,
        gl.UNSIGNED_SHORT,
        0,
        numCubes
    );
    
    // check for gl errors after draw
    const drawError = gl.getError();
    if (drawError !== gl.NO_ERROR) {
        console.error(`   ❌ GL error after draw: ${drawError}`);
    } else {
        console.log(`   ✅ Draw call completed successfully`);
    }
    
    const boundFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    console.log(`   FBO bound: ${boundFBO === renderStructure.pickingFBO}, Status: ${fboStatus === gl.FRAMEBUFFER_COMPLETE ? 'COMPLETE' : fboStatus}`);
    
    const pixel = new Uint8Array(4);
    gl.readPixels(mouseX, canvas.height - mouseY, 1, 1,
                 gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    console.log(` Pick at (${mouseX.toFixed(0)}, ${mouseY.toFixed(0)})`);
    console.log(` Raw pixel RGBA: (${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3]})`);
    
    // If we see magenta (255, 0, 255), nothing was drawn
    if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255) {
        console.log('   ❌ Clicked on cleared background (no voxels rendered)');
        return null;
    }
    
    // Decode instance ID from RGB
    // Shader encodes as: R = high byte, G = mid byte, B = low byte
    // So: ID = R*65536 + G*256 + B
    const instanceID = pixel[0] * 65536 + pixel[1] * 256 + pixel[2];
    
    console.log(`   Decoded instance ID: ${instanceID} (max: ${structure.voxels.length - 1})`);
    console.log(`   Calculation: ${pixel[0]}*65536 + ${pixel[1]}*256 + ${pixel[2]} = ${instanceID}`);
    
    if (instanceID >= structure.voxels.length) {
        console.log(`   ❌ Invalid: ID ${instanceID} out of range [0-${structure.voxels.length - 1}]`);
        return null;
    }
    
    console.log(`    Valid voxel picked!`);
    
    pickedVoxels.add(instanceID);
    console.log(`    Marked voxel ${instanceID} as picked (total picked: ${pickedVoxels.size})`);
    
    const voxel = structure.voxels[instanceID];
    
    // calculate world position
    const centerX = structure.dimensions.nx / 2;
    const centerY = structure.dimensions.ny / 2;
    const centerZ = structure.dimensions.nz / 2;
    
    const worldX = (voxel.x - centerX) * globalScale;
    const worldY = (voxel.y - centerY) * globalScale;
    const worldZ = (voxel.z - centerZ) * globalScale - 1;
    
    return {
        instanceID,
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        value: voxel.value,
        worldX,
        worldY,
        worldZ
    };
}

// reset function for picked voxels
export function clearPickedVoxels() {
    pickedVoxels.clear();
    console.log('🔄 Cleared all picked voxels');
}

