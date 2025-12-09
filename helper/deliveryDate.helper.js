/**
 * Calculate estimated delivery date
 * Skips weekends (Saturday and Sunday)
 * @param {Date} startDate - Starting date for calculation
 * @param {number} days - Number of business days to add (excluding weekends)
 * @returns {Date} - Estimated delivery date
 */
export const calculateDeliveryDate = (startDate, days) => {
  let currentDate = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < days) {
    currentDate.setDate(currentDate.getDate() + 1);
    // 0 = Sunday, 6 = Saturday
    // Add to count only if it's a weekday (Monday-Friday)
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      daysAdded++;
    }
  }

  return currentDate;
};

/**
 * Get delivery days and estimated date based on courier service
 * @param {string} courierService - "regular" or "standard"
 * @returns {Object} - { days: number, estimatedDate: Date }
 */
export const getDeliveryInfo = (courierService) => {
  const today = new Date();
  let days = 4; // default regular

  if (courierService === "standard") {
    days = 2;
  }

  const estimatedDeliveryDate = calculateDeliveryDate(today, days);

  return {
    days,
    estimatedDeliveryDate
  };
};
