# Payment & Order Flow API Guide for Android Developer

Here is the step-by-step API integration guide mapped to the UI screens.

## 1. Checkout Screen (Order Summary)
**User Action:** User reviews the cart and clicks "Proceed to Payment" or selects a Payment Method.

### **API: Create Order**
Call this API when the user confirms the address and is ready to pay.

*   **Endpoint:** `POST /api/order/create`
*   **Auth:** Bearer Token
*   **Body:**
    ```json
    {
      "paymentMethod": "card"  // Options: "cod", "card", "emi", "upi", "netbanking"
    }
    ```
*   **Response (Success):**
    ```json
    {
      "success": true,
      "result": {
        "orderId": "ORD-12345...",
        "order": { ... } // Contains final amount, address, etc.
      }
    }
    ```
*   **Android Logic:** Store the `result.orderId` and `result.order.priceSummary.finalTotal`.

---

## 2. Payment Payment (Initiate Razorpay)

### **Scenario A: Regular Payment (Card, UPI, Netbanking)**
If the user selects Credit/Debit Card, UPI, or Netbanking.

*   **Endpoint:** `POST /api/payment/:orderId/initiate`
    *   Replace `:orderId` with the ID obtained in Step 1 (e.g., `ORD-12345...`).
*   **Body:** (Empty)
*   **Response:**
    ```json
    {
      "success": true,
      "result": {
        "razorpayOrderId": "order_Hj7...",  // Pass to Razorpay SDK
        "amount": 80588,
        "key": "rzp_test_...",             // Razorpay Key ID
        "currency": "INR"
      }
    }
    ```

### **Scenario B: pay In EMI**
If the user selects "Pay in EMI" and chooses a tenure (3, 6, 9, 12 months).

*   **Endpoint:** `POST /api/payment/:orderId/initiate-emi`
*   **Body:**
    ```json
    {
      "tenure": 6  // 3, 6, 9, or 12
    }
    ```
*   **Response:**
    ```json
    {
      "success": true,
      "result": {
        "razorpayOrderId": "order_Hj8...", // Pass to Razorpay SDK
        "emiDetails": { ... }
      }
    }
    ```

---

## 3. Android Razorpay SDK Integration
Use the data from Step 2 to open the Razorpay Checkout.

```java
JSONObject options = new JSONObject();
options.put("key", "rzp_test_..."); // From API response
options.put("amount", "8058800"); // Amount in subunits (paise)
options.put("currency", "INR");
options.put("order_id", "order_Hj7..."); // From API response
options.put("name", "Electro Ecommerce");

checkout.open(activity, options);
```

---

## 4. Payment Success (Verify Payment)
**User Action:** User completes payment in Razorpay.
**Android Logic:** `onPaymentSuccess` method is triggered. You get `payment_id` and `signature`. You **MUST** call this API to confirm the order.

*   **Endpoint:** `POST /api/payment/:orderId/verify`
*   **Body:**
    ```json
    {
      "razorpay_order_id": "order_Hj7...",       // The ID used to open checkout
      "razorpay_payment_id": "pay_Ni...",        // Received from SDK success
      "razorpay_signature": "e5513d..."          // Received from SDK success
    }
    ```
*   **Response:**
    ```json
    {
      "success": true,
      "message": "Payment verified and order confirmed"
      // Show "Order Confirmed" screen to user
    }
    ```

---

## 5. View Order History
To show the list of orders (My Orders Screen).

*   **Endpoint:** `GET /api/order/my-orders`
*   **Query Params (Optional):** `?page=1&limit=10&status=delivered`
