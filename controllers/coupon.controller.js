import mongoose from "mongoose";
import CouponModel from "../models/coupon.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse, sendErrorResponse } from "../utils/response.utils.js";
import cartModel from "../models/cart.model.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

export const createCoupon = async (req, res) => {
    try {
        const {
            code,
            description,
            discountType,
            flatValue,
            percentageValue,
            minOrderValue,
            expiryDate,
            isActive,
        } = req.body;

        const file = req.file;

        if (!code || !description || !discountType || !expiryDate) {
            return sendBadRequestResponse(res, "All required fields must be provided");
        }

        if (!["flat", "percentage"].includes(discountType)) {
            return sendBadRequestResponse(res, "Discount type must be either 'flat' or 'percentage'");
        }

        let finalFlatValue = flatValue || 0;
        let finalPercentageValue = percentageValue || 0;

        if (discountType === "flat") {
            if (!flatValue || flatValue <= 0)
                return sendBadRequestResponse(res, "Flat value must be provided and > 0 for flat type");
            finalPercentageValue = 0;
        } else {
            if (!percentageValue || percentageValue <= 0 || percentageValue > 100)
                return sendBadRequestResponse(res, "Percentage value must be between 1–100 for percentage type");
            finalFlatValue = 0;
        }

        const existCoupon = await CouponModel.findOne({ code: code.toUpperCase() });
        if (existCoupon) return sendBadRequestResponse(res, "Coupon code already exists");

        const [day, month, year] = expiryDate.split("/").map(Number);
        const expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
        if (expiry < new Date()) return sendBadRequestResponse(res, "Expiry date cannot be in the past");

        let couponImageUrl = null;
        if (file) {
            const uploaded = await uploadToS3(file);
            couponImageUrl = uploaded.url;
        }

        const newCoupon = await CouponModel.create({
            code: code.toUpperCase(),
            description,
            discountType,
            flatValue: finalFlatValue,
            percentageValue: finalPercentageValue,
            minOrderValue: minOrderValue || 0,
            expiryDate: expiry,
            isActive: isActive ?? true,
            couponImage: couponImageUrl,
        });

        return sendSuccessResponse(res, "Coupon created successfully", newCoupon);
    } catch (error) {
        console.error(error);
        return ThrowError(res, 500, error.message);
    }
};

export const getAllCoupon = async (req, res) => {
    try {
        const coupons = await CouponModel.find({
            isActive: true,
            expiryDate: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!coupons || coupons.length === 0) {
            return sendNotFoundResponse(res, "No active coupons found!");
        }

        return sendSuccessResponse(res, "Active coupons fetched successfully", coupons);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const getCouponById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID");
        }

        const coupon = await CouponModel.findById(id);
        if (!coupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        return sendSuccessResponse(res, "Coupon fetched successfully", coupon);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;
        const {
            code,
            description,
            discountType,
            flatValue,
            percentageValue,
            minOrderValue,
            expiryDate,
            isActive,
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID!");
        }

        const existingCoupon = await CouponModel.findById(id);
        if (!existingCoupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        if (code && code !== existingCoupon.code) {
            const existCoupon = await CouponModel.findOne({
                code: code.toUpperCase(),
                _id: { $ne: id },
            });
            if (existCoupon) {
                return sendBadRequestResponse(res, "Coupon code already exists");
            }
        }

        const allowedUpdates = [
            "code",
            "description",
            "discountType",
            "flatValue",
            "percentageValue",
            "minOrderValue",
            "expiryDate",
            "isActive",
        ];

        const updates = {};
        Object.keys(req.body).forEach((key) => {
            if (allowedUpdates.includes(key)) {
                updates[key] = req.body[key];
            }
        });

        let finalFlatValue =
            updates.flatValue !== undefined
                ? updates.flatValue
                : existingCoupon.flatValue;
        let finalPercentageValue =
            updates.percentageValue !== undefined
                ? updates.percentageValue
                : existingCoupon.percentageValue;

        if (
            updates.discountType ||
            updates.flatValue !== undefined ||
            updates.percentageValue !== undefined
        ) {
            const type = updates.discountType || existingCoupon.discountType;

            if (type === "flat") {
                if (updates.flatValue !== undefined && updates.flatValue <= 0) {
                    return sendBadRequestResponse(res, "Flat value must be greater than 0");
                }
                finalPercentageValue = 0;
                updates.percentageValue = 0;
            } else if (type === "percentage") {
                if (
                    updates.percentageValue !== undefined &&
                    (updates.percentageValue <= 0 || updates.percentageValue > 100)
                ) {
                    return sendBadRequestResponse(
                        res,
                        "Percentage value must be between 1 and 100"
                    );
                }
                finalFlatValue = 0;
                updates.flatValue = 0;
            }

            updates.flatValue = finalFlatValue;
            updates.percentageValue = finalPercentageValue;
        }

        if (updates.expiryDate) {
            const [day, month, year] = updates.expiryDate.split("/").map(Number);
            updates.expiryDate = new Date(year, month - 1, day, 23, 59, 59, 999);

            if (updates.expiryDate < new Date()) {
                return sendBadRequestResponse(res, "Expiry date cannot be in the past");
            }
        }

        if (updates.code) {
            updates.code = updates.code.toUpperCase();
        }

        if (file) {
            if (existingCoupon.couponImage) {
                await deleteFileFromS3(existingCoupon.couponImage);
            }

            const uploaded = await uploadFile(file);
            updates.couponImage = uploaded.url;
        }

        const updatedCoupon = await CouponModel.findByIdAndUpdate(id, updates, {
            new: true,
            runValidators: true,
        });

        return sendSuccessResponse(res, "Coupon updated successfully!", updatedCoupon);
    } catch (error) {
        console.error("Error updating coupon:", error);
        return ThrowError(res, 500, error.message);
    }
};

export const deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID!");
        }

        const coupon = await CouponModel.findById(id);
        if (!coupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        if (coupon.couponImage) {
            await deleteFileFromS3(coupon.couponImage);
        }

        await CouponModel.findByIdAndDelete(id);

        return sendSuccessResponse(res, "Coupon deleted successfully!", {
            deletedId: id,
        });
    } catch (error) {
        console.error("Error deleting coupon:", error);
        return ThrowError(res, 500, error.message);
    }
};

export const applyCouponController = async (req, res) => {
    try {
        const { code } = req.body;
        const { id: userId } = req.user;

        if (!code) {
            return sendBadRequestResponse(res, "Coupon code is required");
        }

        const cart = await cartModel.findOne({ userId })
            .populate({
                path: "items.productId",
                model: "Product",
                select: "productName title description isActive productDetails shippingReturn rating brand mainCategory category subCategory",
                populate: [
                    {
                        path: "brand",
                        model: "Brand",
                        select: "brandName brandImage",
                    },
                    {
                        path: "mainCategory",
                        model: "MainCategory",
                        select: "mainCategoryName mainCategoryImage",
                    },
                    {
                        path: "category",
                        model: "Category",
                        select: "categoryName categoryImage",
                    },
                    {
                        path: "subCategory",
                        model: "SubCategory",
                        select: "subCategoryName subCategoryImage",
                    },
                ],
            })
            .populate({
                path: "items.productVarientId",
                model: "ProductVariant",
                select: "color images sku Artical_Number",
            });

        if (!cart) {
            return sendNotFoundResponse(res, "Cart not found");
        }

        if (cart.items.length === 0) {
            return sendBadRequestResponse(res, "Cart is empty. Add products to apply coupon.");
        }

        let cartTotal = 0;
        cart.items.forEach((item) => {
            const variant = item.productVarientId;

            if (variant?.color?.sizes && variant.color.sizes.length > 0 && item.selectedSize) {
                // Size-level pricing with selected size
                const selectedSizeObj = variant.color.sizes.find(size => size.sizeValue === item.selectedSize);
                if (selectedSizeObj) {
                    const effectivePrice = selectedSizeObj.discountedPrice && selectedSizeObj.discountedPrice > 0 ? selectedSizeObj.discountedPrice : selectedSizeObj.price;
                    cartTotal += effectivePrice * item.quantity;
                }
            } else if (variant?.color) {
                // Color-level pricing
                const effectivePrice = variant.color.discountedPrice && variant.color.discountedPrice > 0 ? variant.color.discountedPrice : variant.color.price;
                cartTotal += effectivePrice * item.quantity;
            }
        });

        const coupon = await CouponModel.findOne({
            code: code.toUpperCase(),
            isActive: true
        });

        if (!coupon) {
            return sendNotFoundResponse(res, "Invalid or inactive coupon");
        }

        if (coupon.expiryDate < new Date()) {
            return sendBadRequestResponse(res, "Coupon has expired");
        }

        if (cartTotal < coupon.minOrderValue) {
            return sendBadRequestResponse(res, `Minimum order value for this coupon is $${coupon.minOrderValue}`);
        }

        let discount = 0;
        let finalAmount = cartTotal;

        if (coupon.discountType === "percentage") {
            discount = (cartTotal * coupon.percentageValue) / 100;
        } else if (coupon.discountType === "flat") {
            discount = coupon.flatValue;
        }

        if (discount > cartTotal) {
            discount = cartTotal;
        }

        finalAmount = cartTotal - discount;

        cart.appliedCoupon = {
            code: coupon.code,
            couponId: coupon._id,
            discount: discount,
            discountType: coupon.discountType,
            percentageValue: coupon.percentageValue,
            flatValue: coupon.flatValue,
            originalAmount: cartTotal,
            finalAmount: finalAmount
        };

        await cart.save();

        return sendSuccessResponse(res, "Coupon applied successfully", {
            cartId: cart._id,
            items: cart.items,
            appliedCoupon: cart.appliedCoupon,
            originalAmount: cartTotal,
            discount,
            finalAmount,
            discountType: coupon.discountType,
            percentageValue: coupon.percentageValue,
            flatValue: coupon.flatValue,
            minOrderValue: coupon.minOrderValue,
            expiryDate: coupon.expiryDate,
            orderInstruction: cart.orderInstruction,
            isGiftWrap: cart.isGiftWrap
        });

    } catch (error) {
        console.error("applyCouponController error:", error);
        return sendErrorResponse(res, 500, "Error applying coupon", error.message);
    }
};

export const removeCouponController = async (req, res) => {
    try {
        const { id: userId } = req.user;

        const cart = await cartModel.findOne({ userId })
            .populate({
                path: "items.productId",
                model: "Product",
                select: "productName title description isActive productDetails shippingReturn rating brand mainCategory category subCategory",
                populate: [
                    {
                        path: "brand",
                        model: "Brand",
                        select: "brandName brandImage",
                    },
                    {
                        path: "mainCategory",
                        model: "MainCategory",
                        select: "mainCategoryName mainCategoryImage",
                    },
                    {
                        path: "category",
                        model: "Category",
                        select: "categoryName categoryImage",
                    },
                    {
                        path: "subCategory",
                        model: "SubCategory",
                        select: "subCategoryName subCategoryImage",
                    },
                ],
            })
            .populate({
                path: "items.productVarientId",
                model: "ProductVariant",
                select: "color images sku Artical_Number",
            });

        if (!cart) {
            return sendNotFoundResponse(res, "Cart not found");
        }

        let cartTotal = 0;
        cart.items.forEach((item) => {
            const variant = item.productVarientId;

            if (variant?.color?.sizes && variant.color.sizes.length > 0 && item.selectedSize) {
                // Size-level pricing with selected size
                const selectedSizeObj = variant.color.sizes.find(size => size.sizeValue === item.selectedSize);
                if (selectedSizeObj) {
                    const effectivePrice = selectedSizeObj.discountedPrice && selectedSizeObj.discountedPrice > 0 ? selectedSizeObj.discountedPrice : selectedSizeObj.price;
                    cartTotal += effectivePrice * item.quantity;
                }
            } else if (variant?.color) {
                // Color-level pricing
                const effectivePrice = variant.color.discountedPrice && variant.color.discountedPrice > 0 ? variant.color.discountedPrice : variant.color.price;
                cartTotal += effectivePrice * item.quantity;
            }
        });

        const removedCoupon = cart.appliedCoupon;
        cart.appliedCoupon = undefined;
        await cart.save();

        return sendSuccessResponse(res, "Coupon removed successfully", {
            cartId: cart._id,
            items: cart.items,
            originalAmount: cartTotal,
            finalAmount: cartTotal,
            discount: 0,
            removedCoupon: removedCoupon,
            orderInstruction: cart.orderInstruction,
            isGiftWrap: cart.isGiftWrap
        });

    } catch (error) {
        console.error("removeCouponController error:", error);
        return sendErrorResponse(res, 500, "Error removing coupon", error.message);
    }
};