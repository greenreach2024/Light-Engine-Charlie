# Light Engine Charlie - Splash Screen System

## Overview

The Light Engine Charlie splash screen features an advanced animated sequence with a luminous grow light beam traveling diagonally to impact authentic mechanical gears, creating a spectacular horticultural spectrum burst. The animation showcases the precision and science behind grow light technology with accurate wavelength representation.

## Files

- `public/splash-screen.html` - Standalone splash screen demo
- `public/splash-screen.css` - Complete CSS animation system
- `public/splash-screen.js` - Advanced JavaScript controller
- `public/index.html` - Main app with integrated splash screen

## Features

### ✨ Core Animations

1. **Luminous Beam Travel**
   - Originates off-canvas (bottom left)
   - Travels diagonally toward center gear
   - Larger cross-section that tapers during travel
   - Configurable travel time (default: 2.5 seconds)
   - Shimmer effect for enhanced realism

2. **Gear Impact & Glow**
   - Brief glow effect when beam hits center gear
   - Radial gradient with adjustable intensity
   - Additive blending for bright appearance

3. **Spectrum Burst**
   - Rainbow spectrum fans out toward the right
   - Scales and fades in with spring animation
   - Adjustable brilliance/opacity
   - Settles into final static position

4. **Multiple Gears**
   - Semi-transparent, crisp appearance
   - Static during light effects (rotation capability available)
   - Layered depth with different sizes

### 🎛️ Configuration Options

```javascript
const splash = new SplashScreenController({
  beamTravelTime: 2.5,        // Beam travel duration (seconds)
  spectrumBrilliance: 0.8,    // Spectrum opacity (0-1)
  gearGlowIntensity: 0.7,     // Gear glow intensity (0-1)
  autoHide: true,             // Auto-hide after completion
  enableGearRotation: false,  // Enable subtle gear rotation
  enableSounds: false,        // Enable sound effects
  debug: false,               // Debug mode with keyboard controls
  onComplete: callback        // Completion callback function
});
```

### 🎨 Visual Features

- **Transparent Background**: Maintains transparency throughout
- **Additive Blending**: Uses `mix-blend-mode: screen` for bright effects
- **Gradient Systems**: Complex gradients for beam, spectrum, and gears
- **Responsive Design**: Adapts to different screen sizes
- **Smooth Animations**: Uses cubic-bezier timing functions

### ⌨️ Debug Controls (when debug: true)

- **Spacebar**: Restart animation
- **Arrow Up/Down**: Adjust beam travel speed
- **Arrow Left/Right**: Adjust spectrum brilliance
- **R**: Toggle gear rotation
- **S**: Skip splash screen (in main app)

## Usage

### Standalone Splash Screen

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="splash-screen.css">
    <script src="splash-screen.js" defer></script>
</head>
<body>
    <!-- Splash screen HTML structure -->
    <div class="splash-container">
        <!-- Gear system, beam, spectrum elements -->
    </div>
</body>
</html>
```

### Integrated with Main App

The splash screen is automatically integrated into the main `index.html`. It displays first, then transitions to the main application:

```javascript
// Automatic initialization
window.onSplashComplete = function() {
    // Show main application
    document.getElementById('mainApp').style.display = 'block';
};
```

### Programmatic Control

```javascript
// Create custom splash screen
const splash = new SplashScreenController({
    beamTravelTime: 3.0,
    spectrumBrilliance: 0.9,
    onComplete: () => {
        console.log('Splash complete!');
    }
});

// Start animation
splash.start();

// Runtime adjustments
splash.setBeamTravelTime(2.0);
splash.setSpectrumBrilliance(0.7);
splash.enableGearRotation(true);

// Manual control
splash.fadeOut(1000);
splash.restart();
```

## Technical Implementation

### CSS Custom Properties

The system uses CSS custom properties for dynamic control:

```css
:root {
  --beam-travel-time: 2.5s;
  --spectrum-brilliance: 0.8;
  --gear-glow-intensity: 0.7;
}
```

### Animation Sequence

1. **0s**: Beam starts off-canvas
2. **0-2.5s**: Beam travels to center with shimmer effect
3. **2.5s**: Beam impact triggers gear glow
4. **2.8s**: Spectrum burst begins
5. **4.0s**: Title fades in
6. **5.0s**: Animation complete

### Performance Optimization

- Hardware-accelerated transforms
- Efficient keyframe animations
- Minimal DOM manipulation
- Cached element references
- Event-driven state management

## Browser Compatibility

- Modern browsers with CSS3 support
- Hardware acceleration recommended
- Fallback gracefully without animations
- Mobile responsive design

## Development

### Testing

```bash
# Start development server
node server-charlie.js

# Test standalone splash screen
http://127.0.0.1:8091/splash-screen.html

# Test integrated application
http://127.0.0.1:8091
```

### Customization

1. **Modify Timing**: Adjust `--beam-travel-time` CSS property
2. **Change Colors**: Update gradient definitions in CSS
3. **Add Effects**: Extend the SplashScreenController class
4. **Sound Integration**: Implement audio methods in controller

### Future Enhancements

- [ ] Web Audio API integration for sound effects
- [ ] Particle effects for enhanced impact
- [ ] Multiple beam patterns
- [ ] Theme variations (dark/light mode)
- [ ] Touch gesture controls for mobile

## Architecture

```
SplashScreenController
├── Animation Management
├── Configuration System
├── Event Handling
├── Debug Tools
└── Sound Effects (placeholder)

CSS Animation System
├── Keyframe Definitions
├── Blend Modes
├── Custom Properties
└── Responsive Breakpoints
```

The splash screen system provides a professional, configurable, and performant introduction to the Light Engine Charlie application while maintaining the transparency and visual quality requirements.