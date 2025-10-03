/**
 * AI-Assisted Setup Guide Enhancement System
 * Light Engine Charlie V2
 * 
 * This module provides AI placeholder substitution for setup guides,
 * allowing dynamic injection of AI-generated content into static setup templates.
 */

// AI Placeholder patterns that can be used in setup guides
export const AI_PLACEHOLDERS = {
  // Device naming suggestions
  '{{AI_SUGGESTION:device_naming}}': {
    type: 'suggestion',
    category: 'naming',
    description: 'AI-generated device name based on context'
  },
  
  // Optimal placement recommendations
  '{{AI_SUMMARY:optimal_placement}}': {
    type: 'summary',
    category: 'placement',
    description: 'AI analysis of optimal device placement'
  },
  
  // Vendor portal guidance
  '{{AI_GUIDANCE:vendor_portal_tips}}': {
    type: 'guidance',
    category: 'vendor',
    description: 'AI tips for navigating vendor portals'
  },
  
  // Pairing requirements checklist
  '{{AI_CHECKLIST:pairing_requirements}}': {
    type: 'checklist',
    category: 'pairing',
    description: 'AI-generated pairing requirements checklist'
  },
  
  // Common troubleshooting
  '{{AI_TROUBLESHOOTING:common_pairing_issues}}': {
    type: 'troubleshooting',
    category: 'pairing',
    description: 'AI-powered troubleshooting for pairing issues'
  },
  
  // Network security recommendations
  '{{AI_RECOMMENDATION:network_security}}': {
    type: 'recommendation',
    category: 'security',
    description: 'AI security recommendations for network setup'
  },
  
  // Network connectivity validation
  '{{AI_VALIDATION:network_connectivity}}': {
    type: 'validation',
    category: 'connectivity',
    description: 'AI validation steps for network connectivity'
  },
  
  // API key location guidance
  '{{AI_GUIDANCE:api_key_location}}': {
    type: 'guidance',
    category: 'api',
    description: 'AI guidance for finding API keys in vendor portals'
  },
  
  // Optimal naming suggestions
  '{{AI_SUGGESTION:optimal_naming}}': {
    type: 'suggestion',
    category: 'naming',
    description: 'AI suggestions for optimal device naming conventions'
  },
  
  // Post-setup next steps
  '{{AI_NEXT_STEPS:post_setup}}': {
    type: 'next_steps',
    category: 'completion',
    description: 'AI-recommended next steps after setup completion'
  }
};

/**
 * Process AI placeholders in setup guide content
 * @param content - The setup guide content with AI placeholders
 * @param aiSuggestions - AI suggestions from the /ai/setup-assist endpoint
 * @param deviceMetadata - Device metadata for context
 * @returns Processed content with AI placeholders replaced
 */
export function processAIPlaceholders(content: string, aiSuggestions: any[] = [], deviceMetadata: any = {}): string {
  let processedContent = content;
  
  // Process each placeholder
  Object.keys(AI_PLACEHOLDERS).forEach(placeholder => {
    if (processedContent.includes(placeholder)) {
      const replacement = generatePlaceholderContent(placeholder, aiSuggestions, deviceMetadata);
      processedContent = processedContent.replace(new RegExp(escapeRegExp(placeholder), 'g'), replacement);
    }
  });
  
  return processedContent;
}

/**
 * Generate content for a specific AI placeholder
 */
function generatePlaceholderContent(placeholder: string, aiSuggestions: any[], deviceMetadata: any): string {
  const placeholderInfo = AI_PLACEHOLDERS[placeholder as keyof typeof AI_PLACEHOLDERS];
  if (!placeholderInfo) return placeholder; // Keep original if not found
  
  // Find relevant AI suggestions for this placeholder
  const relevantSuggestions = aiSuggestions.filter(suggestion => 
    suggestion.type === placeholderInfo.type || 
    suggestion.category === placeholderInfo.category
  );
  
  switch (placeholderInfo.type) {
    case 'suggestion':
      return formatSuggestion(relevantSuggestions, placeholderInfo.category);
    
    case 'summary':
      return formatSummary(relevantSuggestions, deviceMetadata);
    
    case 'guidance':
      return formatGuidance(relevantSuggestions, placeholderInfo.category);
    
    case 'checklist':
      return formatChecklist(relevantSuggestions);
    
    case 'troubleshooting':
      return formatTroubleshooting(relevantSuggestions);
    
    case 'recommendation':
      return formatRecommendation(relevantSuggestions);
    
    case 'validation':
      return formatValidation(relevantSuggestions);
    
    case 'next_steps':
      return formatNextSteps(relevantSuggestions);
    
    default:
      return generateFallbackContent(placeholderInfo);
  }
}

function formatSuggestion(suggestions: any[], category: string): string {
  if (suggestions.length === 0) return '';
  
  const suggestion = suggestions[0];
  return `
**🤖 AI Suggestion**: ${suggestion.value || suggestion.description}

*${suggestion.reasoning || `AI recommends this ${category} based on your device context.`}*
`;
}

function formatSummary(suggestions: any[], deviceMetadata: any): string {
  if (suggestions.length === 0) return '';
  
  return `
**📊 AI Analysis**:
- Device Type: ${deviceMetadata.category || 'Unknown'}
- Optimal Zone: ${suggestions.find(s => s.field === 'zone')?.value || 'General'}
- Recommended Placement: ${suggestions.find(s => s.type === 'placement')?.description || 'Follow manufacturer guidelines'}
`;
}

function formatGuidance(suggestions: any[], category: string): string {
  if (suggestions.length === 0) return `*💡 AI guidance for ${category} will appear here when available.*`;
  
  const guidance = suggestions.map(s => `• ${s.description || s.value}`).join('\n');
  return `
**💡 AI Guidance**:
${guidance}
`;
}

function formatChecklist(suggestions: any[]): string {
  if (suggestions.length === 0) return '';
  
  const items = suggestions.map(s => `- [ ] ${s.description || s.value}`).join('\n');
  return `
**✅ AI Checklist**:
${items}
`;
}

function formatTroubleshooting(suggestions: any[]): string {
  if (suggestions.length === 0) return '';
  
  const issues = suggestions.map(s => `**Issue**: ${s.problem}\n**Solution**: ${s.solution}`).join('\n\n');
  return `
**🔧 AI Troubleshooting**:
${issues}
`;
}

function formatRecommendation(suggestions: any[]): string {
  if (suggestions.length === 0) return '';
  
  const recommendation = suggestions[0];
  return `
**🔒 AI Security Recommendation**: ${recommendation.description}

*${recommendation.reasoning}*
`;
}

function formatValidation(suggestions: any[]): string {
  if (suggestions.length === 0) return '';
  
  const steps = suggestions.map((s, i) => `${i + 1}. ${s.description || s.value}`).join('\n');
  return `
**✓ AI Validation Steps**:
${steps}
`;
}

function formatNextSteps(suggestions: any[]): string {
  if (suggestions.length === 0) return '';
  
  const steps = suggestions
    .filter(s => s.type === 'next_step')
    .map(s => `• ${s.description}`)
    .join('\n');
  
  return `
**➡️ AI Next Steps**:
${steps}
`;
}

function generateFallbackContent(placeholderInfo: any): string {
  return `*🤖 ${placeholderInfo.description} will appear here when AI assistance is enabled.*`;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Enhanced setup guides with AI placeholders
 * These will be processed by the AI system when guides are displayed
 */
export const AI_ENHANCED_SETUP_TEMPLATES = {
  "managed-by-le": {
    id: "managed-by-le",
    title: "Managed by Light Engine",
    steps: [
      {
        title: "Already connected",
        bodyMd: "This light is already managed by Light Engine. We won't change communication or control. You can safely assign **Name**, **Location**, **Zone**, and **Group**.\n\n{{AI_SUGGESTION:device_naming}}\n\n{{AI_SUMMARY:optimal_placement}}"
      }
    ]
  },
  
  "wifi-generic-vendor": {
    id: "wifi-generic-vendor", 
    title: "Wi-Fi Setup (Vendor Guided)",
    steps: [
      {
        title: "Sign in / Create vendor account",
        bodyMd: "Open the vendor's portal and sign in. After login, return here.\n\n{{AI_GUIDANCE:vendor_portal_tips}}",
        requiresExternalLogin: true,
        openUrl: "ABOUT:RESEARCH_REQUIRED"
      },
      {
        title: "Pair the device",
        bodyMd: "Follow the vendor's pairing instructions (AP mode or QR). Capture any **Device ID** or **Token** if presented. _This varies by manufacturer._\n\n{{AI_CHECKLIST:pairing_requirements}}\n\n{{AI_TROUBLESHOOTING:common_pairing_issues}}"
      },
      {
        title: "Join farm Wi-Fi", 
        bodyMd: "Using the vendor flow, connect the light to the farm SSID/password so it can reach the network.\n\n{{AI_RECOMMENDATION:network_security}}\n\n{{AI_VALIDATION:network_connectivity}}"
      },
      {
        title: "Authorize Light Engine",
        bodyMd: "Enter the **API Key / OAuth token** from the vendor portal into the field below to allow Light Engine to discover and control the device. _If the vendor provides local-LAN control, toggle **Local Control** and enter IP/Port._\n\n{{AI_GUIDANCE:api_key_location}}"
      },
      {
        title: "Discover & Name",
        bodyMd: "Click **Discover**. Select your device from the list, then set **Name**, **Location**, **Zone**, **Group** and **Save**.\n\n{{AI_SUGGESTION:optimal_naming}}\n\n{{AI_NEXT_STEPS:post_setup}}"
      }
    ]
  }
};