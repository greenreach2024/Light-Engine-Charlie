/**
 * Light Engine Charlie - Splash Screen Controller
 * Advanced animation system with configurable beam and spectrum effects
 */

class SplashScreenController {
  constructor(options = {}) {
    this.options = {
      beamTravelTime: options.beamTravelTime || 2.5, // seconds
      spectrumBrilliance: options.spectrumBrilliance || 0.8, // 0-1
      gearGlowIntensity: options.gearGlowIntensity || 0.7, // 0-1
      autoHide: options.autoHide !== false, // default true
      onComplete: options.onComplete || null,
      enableGearRotation: options.enableGearRotation || false,
      enableSounds: options.enableSounds || false,
      debug: options.debug || false
    };

    this.animationState = 'ready'; // ready, playing, completed
    this.startTime = null;
    this.elements = {};
    
    this.init();
  }

  init() {
    this.cacheElements();
    this.applySettings();
    this.setupEventListeners();
    
    if (this.options.debug) {
      console.log('SplashScreenController initialized', this.options);
    }
  }

  cacheElements() {
    this.elements = {
      container: document.querySelector('.splash-container'),
      beam: document.querySelector('.beam'),
      beamGlow: document.querySelector('.beam-glow'),
      gearGlow: document.querySelector('.gear-glow'),
      spectrum: document.querySelector('.spectrum'),
      spectrumContainer: document.querySelector('.spectrum-container'),
      titleContainer: document.querySelector('.title-container'),
      gears: document.querySelectorAll('.gear')
    };

    // Verify all elements exist
    for (const [key, element] of Object.entries(this.elements)) {
      if (!element && key !== 'gears') {
        console.warn(`SplashScreen: Element '${key}' not found`);
      }
    }
  }

  applySettings() {
    // Apply CSS custom properties for dynamic control
    const root = document.documentElement;
    root.style.setProperty('--beam-travel-time', `${this.options.beamTravelTime}s`);
    root.style.setProperty('--spectrum-brilliance', this.options.spectrumBrilliance);
    root.style.setProperty('--gear-glow-intensity', this.options.gearGlowIntensity);

    // Apply gear rotation if enabled
    if (this.options.enableGearRotation) {
      this.elements.gears.forEach((gear, index) => {
        const direction = index % 2 === 0 ? 1 : -1;
        const speed = 8 + (index * 2); // Different speeds for each gear
        gear.style.animation = `gearRotate ${speed}s linear infinite`;
        gear.style.animationDirection = direction === 1 ? 'normal' : 'reverse';
      });
    }
  }

  setupEventListeners() {
    // Listen for animation events
    if (this.elements.beam) {
      this.elements.beam.addEventListener('animationstart', () => {
        this.onBeamStart();
      });
      
      this.elements.beam.addEventListener('animationend', () => {
        this.onBeamComplete();
      });
    }

    if (this.elements.spectrum) {
      this.elements.spectrum.addEventListener('animationend', () => {
        this.onSpectrumComplete();
      });
    }

    // Keyboard controls for development/debugging
    if (this.options.debug) {
      document.addEventListener('keydown', (e) => {
        this.handleDebugKeys(e);
      });
    }
  }

  start() {
    if (this.animationState !== 'ready') {
      console.warn('SplashScreen: Animation already started or completed');
      return;
    }

    this.animationState = 'playing';
    this.startTime = Date.now();
    
    // Trigger animations by adding CSS classes
    this.elements.beam?.classList.add('animate-beam');
    this.elements.beamGlow?.classList.add('animate-beam-glow');
    this.elements.gearGlow?.classList.add('animate-gear-glow');
    this.elements.spectrumContainer?.classList.add('animate-spectrum');
    this.elements.titleContainer?.classList.add('animate-title');

    // Play sound effects if enabled
    if (this.options.enableSounds) {
      this.playBeamSound();
    }

    // Auto-hide after completion
    if (this.options.autoHide) {
      const totalDuration = this.options.beamTravelTime * 1000 + 2000; // beam + 2s buffer
      setTimeout(() => {
        this.fadeOut();
      }, totalDuration);
    }

    if (this.options.debug) {
      console.log('SplashScreen: Animation started');
    }
  }

  onBeamStart() {
    if (this.options.debug) {
      console.log('SplashScreen: Beam animation started');
    }
  }

  onBeamComplete() {
    if (this.options.debug) {
      console.log('SplashScreen: Beam reached target');
    }

    // Play impact sound
    if (this.options.enableSounds) {
      this.playImpactSound();
    }

    // Trigger spectrum burst slightly after beam impact
    setTimeout(() => {
      if (this.options.enableSounds) {
        this.playSpectrumSound();
      }
    }, 300);
  }

  onSpectrumComplete() {
    if (this.options.debug) {
      console.log('SplashScreen: Spectrum animation completed');
    }

    this.animationState = 'completed';
    
    // Call completion callback
    if (this.options.onComplete) {
      this.options.onComplete();
    }
  }

  fadeOut(duration = 1000) {
    if (!this.elements.container) return;

    this.elements.container.style.transition = `opacity ${duration}ms ease-out`;
    this.elements.container.style.opacity = '0';
    
    setTimeout(() => {
      this.elements.container.style.display = 'none';
      
      // Trigger global callback if it exists
      if (window.onSplashComplete) {
        window.onSplashComplete();
      }
    }, duration);
  }

  // Configuration methods
  setBeamTravelTime(seconds) {
    this.options.beamTravelTime = seconds;
    document.documentElement.style.setProperty('--beam-travel-time', `${seconds}s`);
    
    if (this.options.debug) {
      console.log(`SplashScreen: Beam travel time set to ${seconds}s`);
    }
  }

  setSpectrumBrilliance(intensity) {
    this.options.spectrumBrilliance = Math.max(0, Math.min(1, intensity));
    document.documentElement.style.setProperty('--spectrum-brilliance', this.options.spectrumBrilliance);
    
    if (this.options.debug) {
      console.log(`SplashScreen: Spectrum brilliance set to ${this.options.spectrumBrilliance}`);
    }
  }

  setGearGlowIntensity(intensity) {
    this.options.gearGlowIntensity = Math.max(0, Math.min(1, intensity));
    document.documentElement.style.setProperty('--gear-glow-intensity', this.options.gearGlowIntensity);
    
    if (this.options.debug) {
      console.log(`SplashScreen: Gear glow intensity set to ${this.options.gearGlowIntensity}`);
    }
  }

  enableGearRotation(enable = true) {
    this.options.enableGearRotation = enable;
    
    if (enable) {
      this.elements.gears.forEach((gear, index) => {
        const direction = index % 2 === 0 ? 1 : -1;
        const speed = 8 + (index * 2);
        gear.style.animation = `gearRotate ${speed}s linear infinite`;
        gear.style.animationDirection = direction === 1 ? 'normal' : 'reverse';
      });
    } else {
      this.elements.gears.forEach(gear => {
        gear.style.animation = 'none';
      });
    }
  }

  // Sound effects (placeholder implementations)
  playBeamSound() {
    // Implement with Web Audio API or HTML5 Audio
    // Example: this.playAudioFile('beam-travel.wav');
    if (this.options.debug) {
      console.log('SplashScreen: Playing beam sound');
    }
  }

  playImpactSound() {
    if (this.options.debug) {
      console.log('SplashScreen: Playing impact sound');
    }
  }

  playSpectrumSound() {
    if (this.options.debug) {
      console.log('SplashScreen: Playing spectrum sound');
    }
  }

  // Debug controls
  handleDebugKeys(event) {
    if (!this.options.debug) return;

    switch (event.key) {
      case ' ': // Spacebar - restart animation
        event.preventDefault();
        this.restart();
        break;
      case 'ArrowUp': // Increase beam speed
        event.preventDefault();
        this.setBeamTravelTime(Math.max(0.5, this.options.beamTravelTime - 0.2));
        break;
      case 'ArrowDown': // Decrease beam speed
        event.preventDefault();
        this.setBeamTravelTime(this.options.beamTravelTime + 0.2);
        break;
      case 'ArrowRight': // Increase spectrum brilliance
        event.preventDefault();
        this.setSpectrumBrilliance(this.options.spectrumBrilliance + 0.1);
        break;
      case 'ArrowLeft': // Decrease spectrum brilliance
        event.preventDefault();
        this.setSpectrumBrilliance(this.options.spectrumBrilliance - 0.1);
        break;
      case 'r': // Toggle gear rotation
        event.preventDefault();
        this.enableGearRotation(!this.options.enableGearRotation);
        break;
    }
  }

  restart() {
    // Reset animation state
    this.animationState = 'ready';
    
    // Remove animation classes
    const animationClasses = ['animate-beam', 'animate-beam-glow', 'animate-gear-glow', 'animate-spectrum', 'animate-title'];
    
    Object.values(this.elements).forEach(element => {
      if (element && element.classList) {
        animationClasses.forEach(cls => element.classList.remove(cls));
      }
    });

    // Reset container visibility
    if (this.elements.container) {
      this.elements.container.style.opacity = '1';
      this.elements.container.style.display = 'flex';
    }

    // Restart after a brief delay
    setTimeout(() => {
      this.start();
    }, 100);
  }

  // Utility methods
  getAnimationProgress() {
    if (this.animationState !== 'playing' || !this.startTime) {
      return 0;
    }
    
    const elapsed = Date.now() - this.startTime;
    const totalDuration = this.options.beamTravelTime * 1000 + 2000;
    return Math.min(1, elapsed / totalDuration);
  }

  isComplete() {
    return this.animationState === 'completed';
  }

  isPlaying() {
    return this.animationState === 'playing';
  }
}

// Auto-initialize if in browser environment
if (typeof window !== 'undefined') {
  window.SplashScreenController = SplashScreenController;
  
  // Initialize default splash screen when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.splash-container')) {
      window.splashScreen = new SplashScreenController({
        debug: false, // Set to true for development
        beamTravelTime: 2.5,
        spectrumBrilliance: 0.8,
        autoHide: true
      });
      
      // Auto-start the animation
      window.splashScreen.start();
    }
  });
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SplashScreenController;
}