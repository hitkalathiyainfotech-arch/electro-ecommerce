import express from 'express';
import { addNewAddress, createUser, deleteUserAddress, forgotPassword, getAllCountry, getAllUserAddress, getUserAddressById, getUserProfile, resetPassword, selectCountry, selectUserAddress, socialLogin, updateUserAddress, userLogin, verifyOtp } from '../controllers/user.controller.js';
import { sellerAndAdminAuth, UserAuth } from '../middleware/auth.middleware.js';
import { createAdminController, newSellerController, sellerForgetPasswordController, sellerLoginController, sellerPasswordChangeController, sellerPasswordResetController, sellerVerifyForgetOtpController, updateProfile, verifySellerMobileOtpController } from '../controllers/seller.controller.js';

const indexRoutes = express.Router();

indexRoutes.post("/createUser", createUser);
indexRoutes.post("/userLogin", userLogin);

indexRoutes.post("/socialLogin", socialLogin)

indexRoutes.post("/forgotPassword", forgotPassword)
indexRoutes.post("/verifyOtp", verifyOtp)
indexRoutes.post("/resetPassword", resetPassword)

indexRoutes.get("/getAllCountry", getAllCountry);
indexRoutes.get("/selectCountry/:country", UserAuth, selectCountry);

indexRoutes.post("/addNewAddress", UserAuth, addNewAddress);
indexRoutes.patch("/updateUserAddress/:id", UserAuth, updateUserAddress);
indexRoutes.get("/getAllUserAddress", UserAuth, getAllUserAddress);
indexRoutes.get("/getUserAddressById/:id", UserAuth, getUserAddressById);
indexRoutes.delete("/deleteUserAddress/:id", UserAuth, deleteUserAddress);
indexRoutes.post("/selectUserAddress", UserAuth, selectUserAddress);

indexRoutes.get("/getUserProfile", UserAuth, getUserProfile)

//seller.router.js
indexRoutes.post("/new/admin", createAdminController)
indexRoutes.post("/new/seller", newSellerController)
indexRoutes.post("/verify/seller/otp", verifySellerMobileOtpController)
indexRoutes.post("/seller/login", sellerLoginController)
// indexRoutes.post("/seller/updateProfile", sellerAndAdminAuth, upload.single("avatar"), updateProfile)
indexRoutes.post("/seller/forget/password", sellerForgetPasswordController);
indexRoutes.post("/seller/verify/forget/password", sellerVerifyForgetOtpController);
indexRoutes.post("/seller/reset/password", sellerPasswordResetController);
indexRoutes.post("/seller/change/password", sellerAndAdminAuth, sellerPasswordChangeController);


export default indexRoutes;