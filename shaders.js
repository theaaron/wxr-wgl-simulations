
export const VS_SOURCE = `
    attribute vec4 a_position;
    attribute vec3 a_instancePosition;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    varying vec3 v_worldPosition;
    void main() {
        vec4 worldPosition = a_position + vec4(a_instancePosition, 0.0);
        vec4 viewPosition = u_viewMatrix * worldPosition;
        gl_Position = u_projectionMatrix * viewPosition;
        v_worldPosition = worldPosition.xyz;
    }
`;

export const FS_SOURCE = `
    precision mediump float;
    varying vec3 v_worldPosition;
    void main() {
        vec3 color = v_worldPosition * 0.1 + 0.5;
        gl_FragColor = vec4(color, 1.0);
    }
`;

export const SIMPLE_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    attribute vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
    void main() {
        // Scale the cube vertex, then add the instance position
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        v_color = a_color;
    }
`;

export const SIMPLE_FS = `
    precision highp float;
    
    uniform int u_useVertexColor;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
    void main() {
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color: use vertex color if available, otherwise position-based
        vec3 color;
        if (u_useVertexColor == 1) {
            color = v_color * diff;
        } else {
            color = abs(normalize(v_position)) * diff;
        }
        
        gl_FragColor = vec4(color, 0.3); // Semi-transparent
    }
`;

export const PEEL_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        vec3 pos = a_position + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
`;

export const PEEL_FS = `
    precision highp float;
    
    uniform sampler2D u_depthTexture;
    uniform vec2 u_screenSize;
    uniform float u_alpha;
    uniform int u_pass;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        // Calculate screen coordinates
        vec2 screenCoord = gl_FragCoord.xy / u_screenSize;
        
        // Read previous depth
        float prevDepth = texture2D(u_depthTexture, screenCoord).r;
        
        // Current fragment depth
        float currDepth = gl_FragCoord.z;
        
        // Depth peeling: discard if at or in front of previous layer
        if (u_pass > 0 && currDepth <= prevDepth + 0.0001) {
            discard;
        }
        
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color based on position (rainbow cube effect)
        vec3 color = abs(normalize(v_position)) * diff;
        
        // Output depth and color
        gl_FragData[0] = vec4(currDepth, 0.0, 0.0, 1.0); // Depth
        gl_FragData[1] = vec4(color, u_alpha); // Color with alpha
    }
`;

export const BLEND_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const BLEND_FS = `
    precision highp float;
    
    uniform sampler2D u_colorTexture;
    varying vec2 v_texCoord;
    
    void main() {
        vec4 color = texture2D(u_colorTexture, v_texCoord);
        gl_FragColor = color;
    }
`;


export const APPROX_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    attribute vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying float v_depth;
    
    void main() {
        // Scale the cube vertex, then add the instance position
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        vec4 clipPos = u_projectionMatrix * u_viewMatrix * worldPos;
        gl_Position = clipPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        v_color = a_color;
        v_depth = clipPos.z / clipPos.w * 0.5 + 0.5;
    }
`;

export const APPROX_FS = `
    #extension GL_EXT_draw_buffers : require
    precision highp float;
    
    uniform float u_alpha;
    uniform int u_useVertexColor;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying float v_depth;
    
    void main() {
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color: use vertex color if available, otherwise position-based
        vec3 color;
        if (u_useVertexColor == 1) {
            color = v_color * diff;
        } else {
            color = abs(normalize(v_position)) * diff;
        }
        
        // Weight function - reduced multiplier to handle dense overlapping
        float weight = clamp(pow(u_alpha, 2.0) * 1000.0 * pow(1.0 - v_depth, 3.0), 1e-2, 3e3);
        
        // Accumulation buffer: color * alpha * weight
        // gl_FragData[0] = vec4(color * u_alpha, u_alpha) * weight;
        gl_FragData[0] = vec4(color, u_alpha) * weight;
        
        // Revealage buffer: accumulate alpha
        // With additive blending, this sums up the coverage
        gl_FragData[1] = vec4(u_alpha);
    }
`;

export const APPROX_COMPOSITE_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// export const APPROX_COMPOSITE_FS = `
//     precision highp float;
    
//     uniform sampler2D u_accumTexture;
//     uniform sampler2D u_revealTexture;
    
//     varying vec2 v_texCoord;
    
//     void main() {
//         vec4 accum = texture2D(u_accumTexture, v_texCoord);
//         float reveal = texture2D(u_revealTexture, v_texCoord).r;
        
//         // Suppress overflow
//         float maxVal = max(abs(accum.r), max(abs(accum.g), abs(accum.b)));
//         if (maxVal > 1e10) {
//             accum = vec4(accum.a);
//         }
        
//         // Prevent divide by zero
//         vec3 avgColor = accum.rgb / max(accum.a, 0.00001);
        
//         // reveal contains sum of alpha values
//         // Use exponential falloff to maintain alpha responsiveness even with many layers
//         // This approximates: 1 - (1-alpha)^N where N is the number of layers
//         // exp(-reveal * factor) gives us smooth transparency control
//         float transparency = exp(-reveal * 0.2);
        
//         gl_FragColor = vec4(avgColor, 1.0 - transparency);
//     }
// `;

export const APPROX_COMPOSITE_FS = `
    precision highp float;
    
    uniform sampler2D u_accumTexture;
    uniform sampler2D u_revealTexture;
    
    varying vec2 v_texCoord;
    
    void main() {
        vec4 accum = texture2D(u_accumTexture, v_texCoord);
        float reveal = texture2D(u_revealTexture, v_texCoord).r;
        
        float maxVal = max(abs(accum.r), max(abs(accum.g), abs(accum.b)));
        if (maxVal > 1e10) {
            accum = vec4(accum.a);
        }
        
        vec3 avgColor = accum.rgb / max(accum.a, 0.00001);
        
        float layerDarkening = pow(0.85, reveal * 10.0); // Adjust the 5.0 multiplier
        vec3 finalColor = avgColor * layerDarkening;
        
        float transparency = exp(-reveal * 0.2);
        float alpha = 1.0 - transparency;
        
        vec3 backgroundColor = vec3(0.7, 0.7, 0.85);
        
        vec3 blendedColor = mix(backgroundColor, finalColor, alpha);
        
        gl_FragColor = vec4(blendedColor, 1.0);
    }
`;