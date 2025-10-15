//shaders.js
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
        // Normalize position to 0-1 range for color
        vec3 color = v_worldPosition * 0.1 + 0.5;
        gl_FragColor = vec4(color, 1.0);
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
        v_normal = a_position; // Cube normals are just the positions (centered at origin)
    }
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
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying float v_depth;
    
    void main() {
        vec3 pos = a_position + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        vec4 clipPos = u_projectionMatrix * u_viewMatrix * worldPos;
        gl_Position = clipPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        // Linearized depth for weighting
        v_depth = clipPos.z / clipPos.w * 0.5 + 0.5;
    }
`;

export const APPROX_FS = `
    #extension GL_EXT_draw_buffers : require
    precision highp float;
    
    uniform float u_alpha;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying float v_depth;
    
    void main() {
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color based on position
        vec3 color = abs(normalize(v_position)) * diff;
        
        // Weight function: favors closer, more opaque fragments
        // Adjusted to prevent over-brightening
        float weight = u_alpha * max(0.01, 50000.0 * pow(1.0 - v_depth, 3.0));
        
        // Accumulation buffer: weighted premultiplied color
        // Key fix: don't multiply color by alpha again here
        gl_FragData[0] = vec4(color * u_alpha * weight, u_alpha * weight);
        
        // Revealage buffer: accumulate transparency
        // Using proper revealage formula: multiply (1-alpha) values
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

export const APPROX_COMPOSITE_FS = `
    precision highp float;
    
    uniform sampler2D u_accumTexture;
    uniform sampler2D u_revealTexture;
    
    varying vec2 v_texCoord;
    
    void main() {
        vec4 accum = texture2D(u_accumTexture, v_texCoord);
        float reveal = texture2D(u_revealTexture, v_texCoord).r;
        
        // Avoid division by zero
        if (accum.a < 0.00001) {
            discard;
        }
        
        // Weighted average
        vec3 avgColor = accum.rgb / accum.a;
        
        // Clamp to prevent over-brightening
        avgColor = clamp(avgColor, 0.0, 1.0);
        
        // Composite with proper alpha
        gl_FragColor = vec4(avgColor, 1.0 - reveal);
    }
`;

//////
