const VS_SOURCE = `
            attribute vec4 a_position;
            uniform mat4 u_projectionMatrix;
            uniform mat4 u_viewMatrix;
            void main() {
                vec4 viewPosition = u_viewMatrix * a_position;
                gl_Position = u_projectionMatrix * viewPosition;
            }
        `;

        const FS_SOURCE = `
            precision mediump float;
            void main() {
                gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
            }
        `;

        function compileShader(gl, source, type) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        function createProgram(gl, vsSource, fsSource) {
            const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
            const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
            if (!vertexShader || !fragmentShader) return null;
            
            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('Program link error:', gl.getProgramInfoLog(program));
                gl.deleteProgram(program);
                return null;
            }
            return program;
        }

        let gl = null;
        let xrSession = null;
        let xrReferenceSpace = null;
        let program = null;
        let triangleBuffer = null;
        let positionAttrib = null;
        let vrButton = null;
        let statusDiv = null;

        function updateStatus(message) {
            console.log(message);
            if (statusDiv) {
                statusDiv.textContent = message;
            }
        }

        function initGL() {
            const canvas = document.createElement('canvas');
            
            gl = canvas.getContext('webgl', { 
                xrCompatible: true,
                antialias: false,
                alpha: false
            });
            
            if (!gl) {
                updateStatus('Failed to get WebGL context');
                return false;
            }

            program = createProgram(gl, VS_SOURCE, FS_SOURCE);
            if (!program) {
                updateStatus('Failed to create shader program');
                return false;
            }
            
            gl.useProgram(program);

            positionAttrib = gl.getAttribLocation(program, 'a_position');
            program.projectionMatrixUniform = gl.getUniformLocation(program, 'u_projectionMatrix');
            program.viewMatrixUniform = gl.getUniformLocation(program, 'u_viewMatrix');

            const vertices = new Float32Array([
                0.0, 0.5, -2.0,  
               -0.5, -0.5, -2.0,
                0.5, -0.5, -2.0 
            ]);
            
            triangleBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, triangleBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
            
            gl.clearColor(0.1, 0.1, 0.2, 1.0);
            gl.enable(gl.DEPTH_TEST);

            updateStatus('WebGL initialized successfully');
            return true;
        }

        function drawScene(view) {
            const viewport = xrSession.renderState.baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            
            gl.uniformMatrix4fv(program.projectionMatrixUniform, false, view.projectionMatrix);
            gl.uniformMatrix4fv(program.viewMatrixUniform, false, view.transform.inverse.matrix);

            gl.bindBuffer(gl.ARRAY_BUFFER, triangleBuffer);
            gl.vertexAttribPointer(positionAttrib, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(positionAttrib);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        function onXRFrame(time, frame) {
            if (!xrSession) return;
            
            xrSession.requestAnimationFrame(onXRFrame);

            const pose = frame.getViewerPose(xrReferenceSpace);
            if (!pose) return;

            const glLayer = xrSession.renderState.baseLayer;
            gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            
            for (const view of pose.views) {
                drawScene(view);
            }
        }

        async function enterVR() {
            if (xrSession) {
                xrSession.end();
                return;
            }

            try {
                updateStatus('Requesting VR session...');
                
                const session = await navigator.xr.requestSession('immersive-vr');
                xrSession = session;
                
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
                updateStatus('VR ready - you should see a red triangle');
                
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

        window.addEventListener('load', async () => {
            vrButton = document.getElementById('vr-button');
            statusDiv = document.getElementById('status');

            if (!vrButton || !statusDiv) {
                updateStatus('Missing HTML elements');
                return;
            }

            if (!initGL()) {
                updateStatus('WebGL initialization failed');
                return;
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
        });