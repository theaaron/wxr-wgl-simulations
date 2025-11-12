export function drawDNAHelix(gl, instancingExt, numPoints, projMatrix, viewMatrix, program) {
    if (!program) {
        console.error('drawDNAHelix: program is null or undefined');
        return;
    }
    
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
    
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, -2, 1
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, 0.6);
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const radius = 0.15; 
    const height = 2.0;
    const turns = 3;
    const numRungs = 20;  
    
    const totalVertices = numPoints * 2 + numRungs * 2;
    const helixVertices = new Float32Array(totalVertices * 3);
    const helixColors = new Float32Array(totalVertices * 3);
    
    let vertexIndex = 0;
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 0.2;
        helixColors[vertexIndex * 3 + 1] = 0.5;
        helixColors[vertexIndex * 3 + 2] = 1.0;
        
        vertexIndex++;
    }
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2 + Math.PI;  
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 1.0;
        helixColors[vertexIndex * 3 + 1] = 0.2;
        helixColors[vertexIndex * 3 + 2] = 0.5;
        
        vertexIndex++;
    }
    
    for (let i = 0; i < numRungs; i++) {
        const t = i / (numRungs - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 0.8;
        helixColors[vertexIndex * 3 + 1] = 0.8;
        helixColors[vertexIndex * 3 + 2] = 0.8;
        
        vertexIndex++;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle + Math.PI) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle + Math.PI) * radius;
        
        helixColors[vertexIndex * 3] = 0.8;
        helixColors[vertexIndex * 3 + 1] = 0.8;
        helixColors[vertexIndex * 3 + 2] = 0.8;
        
        vertexIndex++;
    }
    
    if (!drawDNAHelix.vertexBuffer) {
        drawDNAHelix.vertexBuffer = gl.createBuffer();
        drawDNAHelix.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawDNAHelix.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixVertices, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawDNAHelix.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
    }
    
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    if (instPosLoc >= 0) {
        gl.disableVertexAttribArray(instPosLoc);
        gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
        if (instancingExt) {
            instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
        }
    }
    
    gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
    
    gl.drawArrays(gl.LINE_STRIP, numPoints, numPoints);
    
    gl.drawArrays(gl.LINES, numPoints * 2, numRungs * 2);
}

