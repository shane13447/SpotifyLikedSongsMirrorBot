/**
 * Produces the current time as an ISO 8601 timestamp string.
 *
 * @returns {string} The current timestamp in ISO 8601 format.
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Minimal console-based logger that prefixes each message with an ISO
 * timestamp and a severity level.
 */
export const logger = {
  /**
   * Logs an informational message to stdout.
   *
   * @param {string} message - The message to log.
   * @returns {void}
   */
  info(message: string): void {
    console.log(`[${timestamp()}] INFO ${message}`);
  },
  /**
   * Logs a warning message to stderr.
   *
   * @param {string} message - The message to log.
   * @returns {void}
   */
  warn(message: string): void {
    console.warn(`[${timestamp()}] WARN ${message}`);
  },
  /**
   * Logs an error message to stderr.
   *
   * @param {string} message - The message to log.
   * @returns {void}
   */
  error(message: string): void {
    console.error(`[${timestamp()}] ERROR ${message}`);
  }
};
