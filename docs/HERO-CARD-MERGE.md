# Hero Platform Card - Design Documentation

## Overview

The Hero Platform Card is a merged, modern design that combines the previous Title Card and Environmental & AI Features card into a single, cohesive component that highlights Light Engine Charlie's key developments and capabilities.

## Design Goals

1. **Unified Presentation**: Merge farm branding, platform identity, and AI features into one clean card
2. **Modern Aesthetic**: Use contemporary design patterns with gradients, shadows, and smooth transitions
3. **Highlight Key Developments**: Showcase SpectraSync®, E.V.I.E, IA In Training, IA Assist, and E.I²
4. **Responsive Design**: Ensure the card works beautifully on all screen sizes
5. **Visual Hierarchy**: Clear distinction between platform status and feature showcase

## Structure

### Header Section
- **Farm Branding** (left): Logo and farm name/tagline (shown when configured)
- **Platform Title** (center): "⚡ Light Engine Charlie" with custom styling
- **Automation Status**: Real-time indicator with pulsing animation
- **Communication Status**: System online/offline indicator

### Features Section
- **Section Header**: "Platform Capabilities" with subtitle
- **AI Showcase Grid**: 5 feature cards in responsive grid layout
  - SpectraSync® (ON)
  - E.V.I.E (OFF)
  - IA In Training (ALWAYS ON)
  - IA Assist (ALWAYS ON)
  - E.I² (DEV)

## Key Features

### Visual Design
- **Gradient Background**: Subtle teal gradient from brand colors
- **Decorative Elements**: Radial gradient overlay in top-right
- **Border Accent**: 4px left border in primary brand color
- **Hover Effects**: Cards lift and expand with smooth transitions
- **Status Badges**: Color-coded badges (green=ON, orange=ALWAYS ON, blue=DEV, gray=OFF)

### Animations
- **Pulsing Automation Dot**: Indicates active/idle state with CSS animations
- **Card Hover**: Transforms scale, shows descriptions, enhances shadows
- **Icon Scaling**: Icons grow on hover for tactile feedback

### Responsive Behavior
- **Desktop (1024px+)**: 5-column grid for features
- **Tablet (768px-1024px)**: Auto-fit grid with minimum 180px columns
- **Mobile (<768px)**: Single column, always-visible descriptions

## Color Coding

### Feature Status Colors
- **ON** (Green): `linear-gradient(135deg, #16A34A, #22C55E)` - Active features
- **OFF** (Gray): `#CBD5E1` - Inactive features
- **ALWAYS ON** (Orange): `linear-gradient(135deg, #F97316, #F97316)` - Continuously running
- **DEV** (Blue): `linear-gradient(135deg, #3B82F6, #1E40AF)` - In development

### Icon Backgrounds
- **SpectraSync**: Primary/Accent gradient (teal)
- **E.V.I.E**: Medium gray (inactive)
- **IA Training**: Orange gradient
- **IA Assist**: Primary/Accent gradient (teal/green)
- **E.I²**: Medium gray (development)

## CSS Classes

### Main Container
- `.hero-platform-card`: Primary wrapper with gradient and border

### Header Section
- `.hero-platform__header`: Flex container for branding and title
- `.hero-platform__branding`: Farm logo and info
- `.hero-platform__title-section`: Platform title and status
- `.hero-platform__automation-status`: Automation indicator
- `.automation-status__dot`: Pulsing status dot

### Features Section
- `.hero-platform__features`: Features wrapper
- `.ai-features-showcase`: Grid container
- `.ai-showcase-card`: Individual feature card
- `.ai-showcase-card__icon`: Feature icon container
- `.ai-showcase-card__content`: Feature title, status, description
- `.ai-showcase-card__status`: Status badge

## JavaScript Integration

### Automation Indicator Updates
The `updateAutomationIndicator()` function now updates both the container and the pulsing dot:

```javascript
function updateAutomationIndicator(status = {}) {
  const indicator = document.getElementById('automationIndicator');
  const statusEl = document.getElementById('automationIndicatorStatus');
  const dotEl = document.getElementById('automationStatusDot');
  
  // Updates classes on both indicator and dot
  // Shows managed zones count or Armed/Idle status
}
```

### Panel Navigation
The `setActivePanel()` function ensures sidebar panels appear after the hero card:

```javascript
// Move the active panel after the title card
const topCard = document.getElementById('topCard');
const next = topCard.nextElementSibling;
if (next !== activePanel) {
  dashboardMain.insertBefore(activePanel, next);
}
```

## Accessibility

- **Semantic HTML**: Proper heading hierarchy (h1, h2, h3)
- **ARIA Live Regions**: `aria-live="polite"` on automation indicator
- **Keyboard Navigation**: All cards are keyboard accessible
- **Focus States**: Clear focus indicators on interactive elements
- **Alt Text**: Descriptive alt text for farm logo

## Browser Support

- **Modern Browsers**: Full support for gradients, animations, grid
- **Fallbacks**: Graceful degradation for older browsers
- **CSS Variables**: Uses CSS custom properties with fallbacks

## Future Enhancements

1. **Click Actions**: Make feature cards interactive (open settings, toggle features)
2. **Live Data**: Connect to real-time feature status endpoints
3. **Animations**: Add subtle shimmer or pulse effects to active features
4. **Customization**: Allow users to reorder or hide features
5. **Metrics**: Show quick stats per feature (e.g., "3 rooms using SpectraSync")

## Files Modified

1. **public/index.html**: Merged card structure
2. **public/styles.charlie.css**: New hero platform styles
3. **public/app.charlie.js**: Updated automation indicator and panel navigation

## Migration Notes

### Removed Elements
- `#environmentalAiCard` (merged into topCard)
- `.ai-features-horizontal` (replaced with `.ai-features-showcase`)
- `.ai-feature-card` (replaced with `.ai-showcase-card`)
- `.automation-indicator__dot` (replaced with `.automation-status__dot`)

### New Elements
- `.hero-platform-card` (main container)
- `.hero-platform__*` (various header elements)
- `.ai-showcase-card` (feature cards)
- `.automation-status__*` (automation indicator elements)

### ID Preservation
- `#topCard` - Still exists, now contains merged content
- `#automationIndicator` - Still exists with new structure
- `#automationIndicatorStatus` - Still exists
- Feature IDs unchanged: `#spectraSyncFeature`, `#evieFeature`, etc.

## Design Inspiration

- **Modern Dashboard UI**: Inspired by contemporary SaaS platforms
- **Card-Based Layout**: Popular in data visualization and admin panels
- **Gradient Accents**: Subtle use of brand gradients for visual interest
- **Micro-interactions**: Hover states and animations for engagement
