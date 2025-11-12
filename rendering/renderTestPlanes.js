export function renderTestPlanes(gl, instancingExt, planeVertexBuffer, planeIndexBuffer, planeColorBuffers, projMatrix, viewMatrix, program) {
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
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    

    if (instPosLoc >= 0) {
        gl.disableVertexAttribArray(instPosLoc);
        gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
        instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    
    const time = Date.now() * 0.001;
    
    const planes = [
        { z: -1.5, alpha: 0.4, colorBufferIndex: 1, rotationOffset: Math.PI * 2 / 3, rotationSpeed: -1.2 }, 
        { z: -1.0, alpha: 0.4, colorBufferIndex: 2, rotationOffset: 0, rotationSpeed: 0.8 }, 
        { z: -2.0, alpha: 0.4, colorBufferIndex: 0, rotationOffset: Math.PI * 4 / 3, rotationSpeed: 0.5 }  ,
    ];
    
    for (const plane of planes) {
        const angle = (time * plane.rotationSpeed) + plane.rotationOffset;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const modelMatrix = new Float32Array([
            cos, -sin, 0, 0,
            sin, cos, 0, 0,
            0, 0, 1, 0,
            0, 0, plane.z, 1
        ]);
        
        gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        
        gl.uniform1f(alphaLoc, plane.alpha);
        
        if (colorLoc >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, planeColorBuffers[plane.colorBufferIndex]);
            gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(colorLoc);
        }
        
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
}

