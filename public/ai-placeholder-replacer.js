/**
 * AI Placeholder Replacement System
 * Handles dynamic replacement of AI template tokens in setup guides
 */

class AIPlaceholderReplacer {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  /**
   * Replace AI placeholders in content with actual AI-generated text
   * @param {string} content - Content containing AI placeholder tokens
   * @param {Object} deviceMetadata - Device context for AI generation
   * @returns {Promise<string>} - Content with placeholders replaced
   */
  async replaceAIPlaceholders(content, deviceMetadata = {}) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    // Find all AI placeholder tokens in the content
    const placeholderRegex = /\{\{AI_([A-Z_]+):([a-zA-Z0-9-]+)\}\}/g;
    const placeholders = [];
    let match;

    while ((match = placeholderRegex.exec(content)) !== null) {
      placeholders.push({
        fullMatch: match[0],
        type: match[1],
        context: match[2]
      });
    }

    if (placeholders.length === 0) {
      return content;
    }

    // Process each placeholder
    let processedContent = content;
    for (const placeholder of placeholders) {
      try {
        const replacement = await this.getAIContent(
          placeholder.type,
          placeholder.context,
          deviceMetadata
        );
        processedContent = processedContent.replace(
          placeholder.fullMatch,
          replacement
        );
      } catch (error) {
        console.warn(`Failed to replace AI placeholder ${placeholder.fullMatch}:`, error);
        // Keep the placeholder as-is if replacement fails
      }
    }

    return processedContent;
  }

  /**
   * Get AI-generated content for a specific placeholder type and context
   * @param {string} type - Type of content (ESTIMATED_TIME, DIFFICULTY, etc.)
   * @param {string} context - Context/device type for the content
   * @param {Object} deviceMetadata - Additional device context
   * @returns {Promise<string>} - Generated content
   */
  async getAIContent(type, context, deviceMetadata) {
    const cacheKey = `${type}:${context}`;
    
    // Return cached content if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Avoid duplicate requests for the same placeholder
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    // Create the request promise
    const requestPromise = this._generateAIContent(type, context, deviceMetadata);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      // Return fallback content on error
      return this._getFallbackContent(type, context);
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Generate AI content by calling the backend endpoint
   * @param {string} type - Content type
   * @param {string} context - Context/device type
   * @param {Object} deviceMetadata - Device metadata
   * @returns {Promise<string>} - Generated content
   */
  async _generateAIContent(type, context, deviceMetadata) {
    const response = await fetch('/ai/setup-assist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceType: context,
        metadata: deviceMetadata,
        requestType: 'placeholder',
        placeholderType: type,
        placeholderContext: context
      })
    });

    if (!response.ok) {
      throw new Error(`AI API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract the relevant content based on type
    switch (type) {
      case 'ESTIMATED_TIME':
        return data.suggestions?.estimatedTime || this._getFallbackContent(type, context);
      case 'DIFFICULTY':
        return data.suggestions?.difficulty || this._getFallbackContent(type, context);
      case 'SUMMARY':
        return data.suggestions?.summary || this._getFallbackContent(type, context);
      case 'TROUBLESHOOTING':
        return data.suggestions?.troubleshooting || this._getFallbackContent(type, context);
      case 'STEP_TIPS':
        return data.suggestions?.stepTips || this._getFallbackContent(type, context);
      default:
        return this._getFallbackContent(type, context);
    }
  }

  /**
   * Get fallback content when AI generation fails
   * @param {string} type - Content type
   * @param {string} context - Context/device type
   * @returns {string} - Fallback content
   */
  _getFallbackContent(type, context) {
    const fallbacks = {
      'ESTIMATED_TIME': '10-15 minutes',
      'DIFFICULTY': 'Moderate',
      'SUMMARY': 'Follow the steps below to configure your device.',
      'TROUBLESHOOTING': 'Check device documentation if you encounter issues.',
      'STEP_TIPS': 'Refer to your device manual for specific details.'
    };

    return fallbacks[type] || '';
  }

  /**
   * Clear the cache (useful for testing or when device context changes)
   */
  clearCache() {
    this.cache.clear();
  }
}

// Global instance
window.aiPlaceholderReplacer = new AIPlaceholderReplacer();