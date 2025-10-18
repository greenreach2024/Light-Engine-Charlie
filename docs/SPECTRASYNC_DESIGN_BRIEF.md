# SpectraSync® Feature - Design Brief
**For Graphic Designer**

## Overview
SpectraSync® is a proprietary AI-driven lighting technology that dynamically optimizes light spectrum in real-time, synchronized with plant growth cycles. It's the flagship feature of Light Engine Charlie.

---

## Brand Identity

### Name & Trademark
- **Full Name**: SpectraSync®
- **Tagline**: "Real-time spectrum optimization synchronized with plant growth cycles"
- **Positioning**: Premium, AI-powered, scientific, cutting-edge

### Visual Personality
- **Futuristic**: Advanced technology meets horticultural science
- **Dynamic**: Constantly adapting and flowing
- **Precise**: Scientific accuracy and data-driven
- **Organic**: Connects technology with natural plant growth

---

## Color Palette

### Primary Spectrum Gradient
The core visual identity is a **full-spectrum gradient** representing the wavelengths of light:

```
Red → Blue → Cool White → Warm White
```

**Exact Color Values:**
1. **Red** (660nm equivalent)
   - Hex: `#EF4444`
   - RGB: `rgb(239, 68, 68)`
   - Usage: Start of gradient, represents far-red and red wavelengths

2. **Blue** (450nm equivalent)
   - Hex: `#3B82F6`
   - RGB: `rgb(59, 130, 246)`
   - Usage: Middle gradient, represents blue/violet wavelengths

3. **Cool White** (High color temp)
   - Hex: `#E0F2FE`
   - RGB: `rgb(224, 242, 254)`
   - Usage: Represents 5000-6500K cool white light

4. **Warm White** (Low color temp)
   - Hex: `#FEF3C7`
   - RGB: `rgb(254, 243, 199)`
   - Usage: End gradient, represents 2700-3500K warm light

### Gradient Configuration
**CSS Linear Gradient:**
```css
background: linear-gradient(
  90deg,
  #EF4444 0%,   /* Red */
  #3B82F6 33%,  /* Blue */
  #E0F2FE 66%,  /* Cool White */
  #FEF3C7 100%  /* Warm White */
);
```

### Supporting Colors
- **Active Status**: `#22C55E` (Green) - System running
- **Background**: `rgba(59, 130, 246, 0.1)` - Subtle blue tint
- **Border**: `rgba(34, 197, 94, 0.5)` - Green glow when active

---

## Icon Design

### Current Icon Specifications

**SVG Dimensions:** 20×20px (viewBox: 0 0 24 24)

**Icon Elements:**
```
▁ ▂ ▅ ▁ ▄ ▇ ▃  ← Waveform pattern
```

**Path Description:**
- Zigzag waveform representing light spectrum
- 7 peaks/valleys showing frequency variation
- Smooth curves (rounded line caps and joins)
- 2.5px stroke width for visibility

**SVG Code:**
```svg
<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <path 
    d="M3 12L6 8L9 14L12 6L15 12L18 4L21 12" 
    stroke="url(#spectrumGradient)" 
    stroke-width="2.5" 
    stroke-linecap="round" 
    stroke-linejoin="round"
  />
  <defs>
    <linearGradient id="spectrumGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#EF4444"/>
      <stop offset="33%" style="stop-color:#3B82F6"/>
      <stop offset="66%" style="stop-color:#E0F2FE"/>
      <stop offset="100%" style="stop-color:#FEF3C7"/>
    </linearGradient>
  </defs>
</svg>
```

### Icon Variations for Different Contexts

#### 1. **Large Hero Icon** (64×64px+)
- Increase stroke width to 3-4px
- Add subtle glow effect
- Consider animated version (gradient moves left-to-right)

#### 2. **Badge/Chip Icon** (16×16px)
- Reduce to 5 peaks instead of 7
- Stroke width: 2px
- Simplify curves slightly

#### 3. **Marketing/Print Icon**
- High-res vector (scalable)
- Add depth with shadow layer
- Consider 3D perspective

---

## Animation Concepts

### 1. **Gradient Flow** (Recommended)
- Spectrum gradient flows left-to-right continuously
- Represents real-time adaptation
- Duration: 2-3 seconds loop
- Easing: linear for smooth flow

**CSS Example:**
```css
@keyframes spectrumFlow {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
```

### 2. **Pulse Effect**
- Subtle scaling (100% → 105% → 100%)
- Represents active scanning/optimization
- Duration: 1.5 seconds
- Easing: ease-in-out

### 3. **Waveform Oscillation**
- Individual peaks move up/down slightly
- Represents frequency modulation
- Duration: 2 seconds staggered
- Easing: sine wave

---

## Typography

### Display Text
- **Font Weight**: 600-700 (Semi-bold to Bold)
- **Tracking**: Standard (0em)
- **Transform**: None (preserve ® symbol)
- **Always include**: ® symbol (registered trademark)

### Recommended Fonts
1. **Modern Tech**: Space Grotesk, Inter, Poppins
2. **Scientific**: IBM Plex Sans, Source Sans Pro
3. **Futuristic**: Orbitron, Exo 2, Rajdhani

### Sizing Hierarchy
- **Hero/Title**: 32-48px
- **Feature Card**: 16-20px
- **Badge**: 12-14px
- **Icon Label**: 10-12px

---

## Layout Examples

### Feature Card Layout
```
┌─────────────────────────────────────┐
│ [Icon]  SpectraSync®                │
│         [ON Badge]                  │
│                                     │
│ Real-time spectrum optimization     │
│ synchronized with plant growth      │
│ cycles                              │
└─────────────────────────────────────┘
```

**Dimensions:**
- Card: 280px × 120px (desktop)
- Icon: 20×20px, 16px margin-right
- Title: 16-18px font size
- Badge: 24px height, 8px padding
- Description: 12-14px, 70% opacity

### Badge Format
```
[🌈 Icon] SpectraSync® [ON]
```

**Specifications:**
- Height: 36-42px
- Padding: 12px horizontal, 8px vertical
- Border radius: 8px
- Border: 1px solid with 30-50% opacity
- Background: Semi-transparent with backdrop blur

---

## Status Indicators

### Active State (ON)
- **Background**: `rgba(34, 197, 94, 0.1)` - Light green
- **Border**: `rgba(34, 197, 94, 0.5)` - Green glow
- **Status Badge**: `#86efac` text on `rgba(34, 197, 94, 0.2)` background
- **Animation**: Subtle pulse or gradient flow

### Inactive State (OFF)
- **Background**: `rgba(100, 116, 139, 0.1)` - Gray
- **Border**: `rgba(100, 116, 139, 0.3)` - Muted
- **Status Badge**: `#94a3b8` text on `rgba(100, 116, 139, 0.2)` background
- **Animation**: None or very subtle

---

## Use Cases & Contexts

### 1. **Dashboard Display**
- Prominent feature card
- Live status indicator
- Animated gradient when active
- Click to expand details

### 2. **Marketing Materials**
- Hero feature in presentations
- Print brochures with high-res icon
- Website landing page
- Video motion graphics

### 3. **Technical Documentation**
- Simplified icon (single color)
- Diagram integration
- Flow charts showing automation

### 4. **Mobile App**
- Compact badge format
- Touch-friendly sizes (44px+ tap target)
- Simplified animation for performance

---

## Design Specifications

### Spacing
- **Icon to Text**: 12-16px
- **Text to Badge**: 8-12px
- **Card Padding**: 16-24px
- **Card Gap**: 12-16px between cards

### Borders & Effects
- **Border Radius**: 8-12px (modern, friendly)
- **Border Width**: 1-2px
- **Shadow**: `0 4px 12px rgba(59, 130, 246, 0.15)`
- **Backdrop Blur**: 10-15px for glassmorphism

### Hover States
- **Transform**: `translateY(-2px)`
- **Shadow**: Increase to `0 6px 20px rgba(59, 130, 246, 0.25)`
- **Border**: Brighten by 20%
- **Transition**: `all 0.3s ease`

---

## Accessibility

### Color Contrast
- Text on background must meet WCAG AA (4.5:1 minimum)
- Status badges: High contrast colors chosen
- Never rely on color alone (include text labels)

### Icon Alternatives
- Always pair icon with text label
- Provide alt text for images
- Use ARIA labels for interactive elements

### Motion Sensitivity
- Provide reduced-motion option
- Disable animations if user prefers reduced motion
- Keep animations subtle (avoid rapid flashing)

---

## Print Specifications

### Logo Lockup
```
[Icon]  SpectraSync®
        Real-time spectrum optimization
```

### Color Modes

**Full Color (CMYK):**
- Red: C:0 M:88 Y:74 K:0
- Blue: C:71 M:41 Y:0 K:0
- Cool White: C:12 M:3 Y:0 K:0
- Warm White: C:1 M:5 Y:25 K:0

**Black & White:**
- Icon: 100% black with gradient replaced by solid fill
- Alternative: Dotted/dashed gradient pattern

**Spot Color:**
- Consider Pantone equivalent for spectrum gradient
- Metallic ink option for premium applications

### Minimum Sizes
- **Print**: 0.5 inch width minimum
- **Digital**: 16px minimum
- **Always legible**: Text remains readable at minimum size

---

## File Formats to Provide

### Vector Files
- **SVG**: Web, scalable graphics
- **AI/EPS**: Print, full editability
- **PDF**: Universal viewing

### Raster Files
- **PNG**: Transparent background, multiple sizes
  - 16×16, 24×24, 32×32 (UI)
  - 64×64, 128×128, 256×256 (icons)
  - 512×512, 1024×1024 (marketing)
- **JPG**: White background version for email/docs
- **WebP**: Optimized for web (smaller file size)

### Animation Files
- **GIF**: Simple looping animation
- **Lottie/JSON**: Complex, lightweight web animation
- **MP4/WebM**: Video format for presentations

---

## Brand Guidelines Summary

### Do's ✓
- ✓ Always use the ® symbol
- ✓ Use the full spectrum gradient
- ✓ Maintain minimum size requirements
- ✓ Pair icon with descriptive text
- ✓ Use provided color values exactly
- ✓ Add subtle animations when active
- ✓ Ensure high contrast for accessibility

### Don'ts ✗
- ✗ Don't modify the gradient order
- ✗ Don't use solid colors instead of gradient
- ✗ Don't stretch or distort the icon
- ✗ Don't remove the ® trademark symbol
- ✗ Don't use low-contrast color combinations
- ✗ Don't make icon too small to recognize
- ✗ Don't use competing color schemes nearby

---

## Example Implementations

### Website Hero
```html
<div class="spectrasync-hero">
  <div class="icon">[SVG Icon]</div>
  <h1>SpectraSync®</h1>
  <p class="tagline">Real-time spectrum optimization</p>
  <span class="badge">ACTIVE</span>
</div>
```

### Feature Card
```html
<div class="feature-card active">
  <div class="icon">[SVG Icon]</div>
  <div class="content">
    <h3>SpectraSync®</h3>
    <span class="status on">ON</span>
    <p>Real-time spectrum optimization...</p>
  </div>
</div>
```

### Mobile Badge
```html
<div class="ai-badge active">
  [Icon] SpectraSync® <span class="status">ON</span>
</div>
```

---

## Technical Notes

### Performance
- SVG preferred over PNG (scalable, smaller file size)
- Use CSS animations over JavaScript when possible
- Optimize gradient rendering (avoid too many color stops)
- Consider prefers-reduced-motion media query

### Browser Support
- Gradient works in all modern browsers
- Provide fallback solid color for old browsers
- Test animation performance on mobile devices
- Ensure icon renders clearly at 1x and 2x DPI

---

## Questions for Designer?

1. **Logo Variations**: Need horizontal, vertical, or icon-only versions?
2. **Animation Complexity**: Simple gradient flow or complex waveform?
3. **Marketing Materials**: Specific dimensions/formats needed?
4. **3D Rendering**: Interest in 3D icon version for hero sections?
5. **Brand Extensions**: Need coordinated designs for other AI features?

---

## Contact & Approval

All final designs should:
- Match the spectrum gradient exactly
- Maintain brand consistency with Light Engine Charlie
- Be delivered in multiple formats (vector + raster)
- Include source files for future editing
- Follow accessibility guidelines

**Project**: Light Engine Charlie
**Feature**: SpectraSync® (Registered Trademark)
**Date**: October 17, 2025
**Status**: Active Production Feature

---

## Additional Assets Needed

1. High-res icon sheet (all sizes)
2. Animated GIF/Lottie file
3. Social media graphics (1200×630, 1080×1080)
4. Print-ready logo lockup
5. Style guide page for SpectraSync®
6. Email signature version
7. Presentation slide template
8. App icon variants (iOS, Android)

---

**End of Design Brief**

For questions or asset requests, please reference this document.
