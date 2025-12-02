import express from 'express';
import { addNewAddress, createUser, forgotPassword, getAllCountry, resetPassword, selectCountry, socialLogin, updateUserAddress, userLogin, verifyOtp } from '../controllers/user.controller.js';
import { UserAuth } from '../middleware/auth.middleware.js';

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
indexRoutes.patch("/updateUserAddress/:id", UserAuth, updateUserAddress)

export default indexRoutes;