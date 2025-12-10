import brandModel from "../models/brand.model.js";
import productModel from "../models/product.model.js";
import productVarientModel from "../models/productVarient.model.js";
import { sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { createProductVariant } from "./productVariant.controller.js";

export const newArrival = async (req, res) => {
  try {
    const products = await productModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(15)
      .populate("brand")
      .populate("categories")
      .populate({
        path: "variantId",
        options: { limit: 1 }
      })

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId.length > 0 ? [p.variantId[0]] : []
      }
    })

    return sendSuccessResponse(res, "new Arrival featched successfully", {
      total: formatted.length,
      products: formatted
    })
  } catch (error) {
    console.log("error while get newArrival : " + error)
    return sendErrorResponse(res, 500, "error while get newArrival", error)
  }
}


export const bestSeller = async (req, res) => {
  try {
    const products = await productModel.find({}).sort({ sold: -1 }).limit(15);

    return sendSuccessResponse(res, "best selling Products", products);
  } catch (error) {
    console.log("Error while bestSeller", error)
    return sendErrorResponse(res, 500, "Error while bestSeller", error)
  }
}


export const trendingDeals = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const products = await productModel
      .aggregate([
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ["$sold", 2] },
                { $multiply: ["$views", 1] },
                {
                  $cond: [
                    { $gte: ["$createdAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                    50,
                    0
                  ]
                }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]);

    const ids = products.map(x => x._id);

    const finalProducts = await productModel
      .find({ _id: { $in: ids } })
      .populate("sellerId", "firstName email mobileNo avatar")
      .populate("brand", "brandName brandImage")
      .populate("categories", "name image")
      .populate("variantId", "-overview -key_features -specification")

    return sendSuccessResponse(res, "Trending Deals Products", {
      total: finalProducts.length,
      products: finalProducts
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching trending deals", error);
  }
};

export const grabNowDeals = async (req, res) => {
  try {
    const variants = await productVarientModel.find({})
      .populate({
        path: "productId",
        populate: [
          { path: "brand" },
          { path: "categories" },
        ]
      })
      .populate("sellerId");

    const deals = [];

    for (const v of variants) {
      const color = v.color;
      if (!color) continue;

      let effectivePrice = 0;
      let originalPrice = 0;
      let stock = 0;

      if (color.sizes && color.sizes.length > 0) {
        const sizesInStock = color.sizes.filter(s => s.stock > 0);
        if (sizesInStock.length === 0) continue;

        const size = sizesInStock[0];

        originalPrice = size.price;
        effectivePrice = size.discountedPrice || size.price;
        stock = size.stock;
      } else {
        if (color.stock <= 0) continue;

        originalPrice = color.price;
        effectivePrice = color.discountedPrice || color.price;
        stock = color.stock;
      }

      const discountPercent =
        originalPrice > 0
          ? Math.round(((originalPrice - effectivePrice) / originalPrice) * 100)
          : 0;

      deals.push({
        variantId: v._id,
        productId: v.productId,
        sellerId: v.sellerId,
        variantTitle: v.variantTitle,
        images: color.images || [],
        originalPrice,
        discountedPrice: effectivePrice,
        discountPercent,
        stock
      });
    }

    deals.sort((a, b) => {
      if (b.discountPercent !== a.discountPercent) {
        return b.discountPercent - a.discountPercent;
      }
      return a.discountedPrice - b.discountedPrice;
    });

    return sendSuccessResponse(res, "Grab Now Deals Fetched", {
      total: deals.length,
      products: deals.slice(0, 10)
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};
