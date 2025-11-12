export function drawHelixCubes(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, numCubes, projMatrix, viewMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    // PHONG: Get lighting uniform locations
    const lightDirLoc = gl.getUniformLocation(program, 'u_lightDirection');
    const lightColorLoc = gl.getUniformLocation(program, 'u_lightColor');
    const lightAmbientLoc = gl.getUniformLocation(program, 'u_lightAmbient');
    const lightSpecularLoc = gl.getUniformLocation(program, 'u_lightSpecular');
    const matAmbientLoc = gl.getUniformLocation(program, 'u_materialAmbient');
    const matSpecularLoc = gl.getUniformLocation(program, 'u_materialSpecular');
    const shininessLoc = gl.getUniformLocation(program, 'u_shininess');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    // PHONG: Set lighting uniforms - reduced specular to prevent blown-out highlights
    if (lightDirLoc !== null) gl.uniform3f(lightDirLoc, 0.5, 0.5, -1.0);
    if (lightColorLoc !== null) gl.uniform3f(lightColorLoc, 1.0, 1.0, 1.0);
    if (lightAmbientLoc !== null) gl.uniform3f(lightAmbientLoc, 0.6, 0.6, 0.6);
    if (lightSpecularLoc !== null) gl.uniform3f(lightSpecularLoc, 0.3, 0.3, 0.3);  // Reduced from 0.8
    if (matAmbientLoc !== null) gl.uniform3f(matAmbientLoc, 1.0, 1.0, 1.0);
    if (matSpecularLoc !== null) gl.uniform3f(matSpecularLoc, 0.2, 0.2, 0.2);  // Reduced from 0.5
    if (shininessLoc !== null) gl.uniform1f(shininessLoc, 32.0);
    

    const scale = 0.5; 
    const modelMatrix = new Float32Array([
        scale, 0, 0, 0,      
        0, scale, 0, 0,      
        0, 0, scale, 0,      
        0, 0, -2, 1          
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, ALPHA); // Fully opaque
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const radius = 0.3;
    const height = 2.0;
    const turns = 3;
    
    const helixPositions = new Float32Array(numCubes * 3);
    const helixColors = new Float32Array(numCubes * 3);
    
    for (let i = 0; i < numCubes; i++) {
        const t = i / (numCubes - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixPositions[i * 3] = Math.cos(angle) * radius;
        helixPositions[i * 3 + 1] = y;
        helixPositions[i * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[i * 3] = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
        helixColors[i * 3 + 1] = Math.sin(t * Math.PI * 2 + Math.PI * 2 / 3) * 0.5 + 0.5;
        helixColors[i * 3 + 2] = Math.sin(t * Math.PI * 2 + Math.PI * 4 / 3) * 0.5 + 0.5;
    }
    
    if (!drawHelixCubes.positionBuffer) {
        drawHelixCubes.positionBuffer = gl.createBuffer();
        drawHelixCubes.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixPositions, gl.DYNAMIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);  
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1); 
    
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
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

