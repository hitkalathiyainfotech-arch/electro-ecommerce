import express from 'express';
import { addNewAddress, createUser, deleteUserAddress, forgotPassword, getAllCountry, getAllUserAddress, getUserAddressById, resetPassword, selectCountry, selectUserAddress, socialLogin, updateUserAddress, userLogin, verifyOtp } from '../controllers/user.controller.js';
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
indexRoutes.patch("/updateUserAddress/:id", UserAuth, updateUserAddress);
indexRoutes.get("/getAllUserAddress", UserAuth, getAllUserAddress);
indexRoutes.get("/getUserAddressById/:id", UserAuth, getUserAddressById);
indexRoutes.delete("/deleteUserAddress/:id", UserAuth, deleteUserAddress);
indexRoutes.post("/selectUserAddress", UserAuth, selectUserAddress);

export default indexRoutes;