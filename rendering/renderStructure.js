import { loadStructure } from './loadStructure.js';

export async function renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, path, projMatrix, viewMatrix, modelMatrix, program) {
    if (!renderStructure.cachedStructure) {
        path = './resources/atria_64x64x64.json';
        try {
            renderStructure.cachedStructure = await loadStructure(path);
            const struct = renderStructure.cachedStructure;
            console.log(`Loaded ${struct.voxels.length} voxels`);
            console.log(`Grid dimensions: ${struct.dimensions.nx}×${struct.dimensions.ny}×${struct.dimensions.nz}`);
            console.log(`Sample voxels:`, struct.voxels.slice(0, 5));
            console.log(`First voxel coords: x=${struct.voxels[0].x}, y=${struct.voxels[0].y}, z=${struct.voxels[0].z}`);
            console.log(`Second voxel coords: x=${struct.voxels[1].x}, y=${struct.voxels[1].y}, z=${struct.voxels[1].z}`);
            console.log(`Rendering ${struct.voxels.length} cube instances`);
        } catch (error) {
            console.error('Failed to load structure:', error);
            return;
        }
    }
    
    const structure = renderStructure.cachedStructure;
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
    if (Date.now() - (renderStructure.lastLog || 0) > 1000) {
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
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    

    const globalScale = 0.02; 
    const zScale = renderStructure.zScale || 1.0;
    modelMatrix = new Float32Array([
        globalScale, 0, 0, 0,      
        0, globalScale, 0, 0,      
        0, 0, globalScale * zScale, 0, // z scale not needed anymore but i'll leave it here for now
        0, 0, -1, 1     
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    

    const voxelSize = renderStructure.voxelScale || 3.0;
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
        
        // Color: normalize voxel value to 0-1 range and create color gradient
        const normalizedValue = voxel.value / 255.0;
        structureColors[i * 3] = normalizedValue; // Red based on value
        structureColors[i * 3 + 1] = 0.5 + normalizedValue * 0.5; // Green
        structureColors[i * 3 + 2] = 1.0 - normalizedValue * 0.5; // Blue
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
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36,  
        gl.UNSIGNED_SHORT, 
        0, 
        numCubes
    );

}

