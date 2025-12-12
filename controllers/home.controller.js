import mongoose from "mongoose";
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


export const getFiltteredProducts = async (req, res) => {
  try {
    const {
      categories,
      brand,
      minPrice,
      maxPrice,
      color,
      size,
      storage,
      ram,
      sort,
      page = 1,
      limit = 20
    } = req.query

    const matchProduct = { isActive: true }
    const matchVariant = {}

    if (categories)
      matchProduct.categories = {
        $in: categories.split(",").map(id => new mongoose.Types.ObjectId(id))
      }

    if (brand)
      matchProduct.brand = {
        $in: brand.split(",").map(id => new mongoose.Types.ObjectId(id))
      }

    const priceFilter = {}
    if (minPrice) priceFilter.$gte = Number(minPrice)
    if (maxPrice) priceFilter.$lte = Number(maxPrice)

    if (minPrice || maxPrice) {
      matchVariant.$or = [
        { "color.price": priceFilter },
        { "color.discountedPrice": priceFilter },
        { "color.sizes.price": priceFilter },
        { "color.sizes.discountedPrice": priceFilter }
      ]
    }

    if (color)
      matchVariant["color.colorName"] = { $in: color.split(",") }

    if (size)
      matchVariant["color.sizes.sizeValue"] = { $in: size.split(",") }

    if (storage)
      matchVariant["specification.details"] = {
        $elemMatch: {
          key: { $regex: "storage|rom|internal", $options: "i" },
          value: { $regex: storage.split(",").join("|"), $options: "i" }
        }
      }

    if (ram)
      matchVariant["specification.details"] = {
        $elemMatch: {
          key: { $regex: "ram|memory", $options: "i" },
          value: { $regex: ram.split(",").join("|"), $options: "i" }
        }
      }

    const pipeline = [
      { $match: matchProduct },
      {
        $lookup: {
          from: "productvariants",
          localField: "_id",
          foreignField: "productId",
          as: "variants"
        }
      },
      { $unwind: "$variants" }
    ]

    if (Object.keys(matchVariant).length) {
      const transformedVariantFilter = {}
      for (const key in matchVariant) transformedVariantFilter[`variants.${key}`] = matchVariant[key]
      pipeline.push({ $match: transformedVariantFilter })
    }

    pipeline.push(
      {
        $group: {
          _id: "$_id",
          product: { $first: "$$ROOT" },
          variants: { $push: "$variants" }
        }
      },
      { $project: { product: 1, variants: 1 } }
    )

    if (sort === "price_low")
      pipeline.push({ $sort: { "variants.color.price": 1 } })

    if (sort === "price_high")
      pipeline.push({ $sort: { "variants.color.price": -1 } })

    if (sort === "latest")
      pipeline.push({ $sort: { "product.createdAt": -1 } })

    if (sort === "popular")
      pipeline.push({ $sort: { "product.sold": -1 } })

    pipeline.push({ $skip: (page - 1) * limit })
    pipeline.push({ $limit: Number(limit) })

    const data = await productModel.aggregate(pipeline)

    return res.status(200).json({ success: true, count: data.length, data })
  } catch (error) {
    return sendErrorResponse(
      res,
      500,
      "Error while fetching filtered products",
      error
    )
  }
}

