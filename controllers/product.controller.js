import mongoose from "mongoose";
import Product from "../models/product.model.js";
import ProductVariant from "../models/productVarient.model.js";
import sellerModel from "../models/seller.model.js";
import CategoryModel from "../models/category.model.js";
import brandModel from "../models/brand.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";
import productVarientModel from "../models/productVarient.model.js";
import categoryModel from "../models/category.model.js";
import productModel from "../models/product.model.js";
import reviewModel from "../models/review.model.js";

// Helper to recursively get all child category IDs
const getAllChildCategoryIds = async (categoryId) => {
  const children = await categoryModel.find({ parentCategory: categoryId }).select("_id");
  let allIds = children.map(c => c._id);

  for (const child of children) {
    const subChildren = await getAllChildCategoryIds(child._id);
    allIds = [...allIds, ...subChildren];
  }
  return allIds;
};



export const createProduct = async (req, res) => {
  try {
    const { brand, title, description, categoryId: bodyCategoryId, categories: bodyCategories } = req.body;
    const sellerId = req.user?._id;
    const productBannerImages = req.files;

    // Support both categoryId and categories (as singular ID) from frontend
    const categoryId = bodyCategoryId || bodyCategories;

    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
      return sendBadRequestResponse(res, "Invalid or missing seller ID");
    }

    const seller = await sellerModel.findById(sellerId).populate("brandId");
    if (!seller) return sendNotFoundResponse(res, "Seller not found");

    if (!seller.brandId || seller.brandId.length === 0) {
      return sendBadRequestResponse(res, "Please add a brand first Or this not createdBy You");
    }

    if (!brand) return sendBadRequestResponse(res, "Brand is required");
    if (!mongoose.Types.ObjectId.isValid(brand)) {
      return sendBadRequestResponse(res, "Invalid brand ID");
    }

    const selectedBrand = await brandModel.findById(brand);
    if (!selectedBrand) return sendNotFoundResponse(res, "Brand not found");

    const isValidBrand = seller.brandId.some(b => b._id.toString() === brand);
    if (!isValidBrand) return sendBadRequestResponse(res, "This brand does not belong to you");

    if (!title) return sendBadRequestResponse(res, "Title is required");

    let categories = [];

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return sendBadRequestResponse(res, "Invalid Category ID");
      }
      const categoryExists = await CategoryModel.findById(categoryId);
      if (!categoryExists) {
        return sendNotFoundResponse(res, "Category not found");
      }
      // Fetch full hierarchy (Child -> Parent -> Root)
      categories = [categoryId];
    } else if (selectedBrand.categories && selectedBrand.categories.length > 0) {
      categories = selectedBrand.categories;
      const categoriesExist = await CategoryModel.find({ _id: { $in: categories } });
      if (categoriesExist.length !== categories.length) {
        return sendNotFoundResponse(res, "Some brand categories not found");
      }
    } else {
      return sendBadRequestResponse(res, "Category is required");
    }

    const existingProduct = await Product.findOne({
      title,
      sellerId,
      brand
    });
    if (existingProduct) return sendBadRequestResponse(res, "This product already exists");

    let productBannerUrls = [];
    if (productBannerImages && productBannerImages.length > 0) {
      for (const file of productBannerImages) {
        const imageUrl = await uploadToS3(file, "product-banners");
        productBannerUrls.push(imageUrl);
      }
    }

    const productData = {
      sellerId,
      brand,
      title,
      categories,
      description: description || "",
      productBanner: productBannerUrls
    };

    const newProduct = await Product.create(productData);

    await sellerModel.findByIdAndUpdate(
      sellerId,
      { $push: { products: newProduct._id } },
      { new: true }
    );

    const populatedProduct = await Product.findById(newProduct._id)
      .populate("brand", "brandName brandImage")
      .populate("categories", "name image");

    return sendSuccessResponse(res, "Product created successfully", populatedProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllProduct = async (req, res) => {
  try {
    const products = await Product.find()
      .populate("brand", "brandName logo description")
      .populate("sellerId", "firstName lastName email shopName")
      .populate("categories", "name image")
      .populate("variantId");

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      result: products || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Product ID" });
    }

    let product = await Product.findById(id)
      .populate("brand", "brandName brandImage")
      .populate("sellerId", "firstName lastName email mobileNo shopName pickUpAddr")
      .populate("categories", "name image");

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    product.view = (product.view || 0) + 1;
    await product.save();

    const response = {
      _id: product._id,
      title: product.title,
      sellerId: product.sellerId,
      description: product.description,
      productBanner: product.productBanner,
      isActive: product.isActive,
      view: product.view,
      rating: product.rating,
      brand: product.brand,
      categories: product.categories,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    };

    return res.status(200).json({ success: true, message: "Product fetched successfully", result: response });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

export const getSellerProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const products = await Product.find({ sellerId })
      .populate("brand", "brandName logo description")
      .populate("sellerId", "firstName lastName email shopName")
      .populate("categories", "name image")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Seller products fetched",
      length: products.length,
      data: products || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { brand, title, description, isActive, categoryId: bodyCategoryId, categories: bodyCategories } = req.body;
    const categoryId = bodyCategoryId || bodyCategories;
    const sellerId = req.user?._id;
    const userRole = req.user?.role;
    const productBannerImages = req.files;

    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
      return sendBadRequestResponse(res, "Invalid seller ID");
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid product ID");
    }

    const product = await Product.findById(id);
    if (!product) {
      return sendNotFoundResponse(res, "Product not found");
    }

    // Authorization check
    if (userRole === 'seller' && product.sellerId.toString() !== sellerId.toString()) {
      return sendBadRequestResponse(res, "You can only update your own products");
    }

    let updateData = {};

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return sendBadRequestResponse(res, "Invalid Category ID");
      }
      const categoryExists = await CategoryModel.findById(categoryId);
      if (!categoryExists) {
        return sendNotFoundResponse(res, "Category not found");
      }
      updateData.categories = [categoryId];
    } else if (brand && brand !== product.brand.toString()) {
      if (!mongoose.Types.ObjectId.isValid(brand)) {
        return sendBadRequestResponse(res, "Invalid brand ID");
      }
      const seller = await sellerModel.findById(sellerId).populate("brandId");
      if (!seller) return sendNotFoundResponse(res, "Seller not found");

      const isValidBrand = seller.brandId.some(b => b._id.toString() === brand);
      if (!isValidBrand) return sendBadRequestResponse(res, "This brand does not belong to you");

      updateData.brand = brand;

      const selectedBrand = await brandModel.findById(brand);
      if (selectedBrand && selectedBrand.categories && selectedBrand.categories.length > 0) {
        updateData.categories = selectedBrand.categories;
      }
    }

    if (productBannerImages && productBannerImages.length > 0) {
      let productBannerUrls = [...(product.productBanner || [])];

      for (let i = 0; i < productBannerImages.length; i++) {
        const file = productBannerImages[i];

        if (i < productBannerUrls.length) {
          const oldImageUrl = productBannerUrls[i];
          const key = oldImageUrl.split(".amazonaws.com/")[1];
          const newImageUrl = await updateS3(key, file);
          productBannerUrls[i] = newImageUrl;
        } else {
          const imageUrl = await uploadToS3(file, "product-banners");
          productBannerUrls.push(imageUrl);
        }
      }

      updateData.productBanner = productBannerUrls;
    }

    if (Object.keys(updateData).length === 0) {
      return sendBadRequestResponse(res, "No changes provided to update");
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('brand', 'brandName')
      .populate('categories', 'name');

    return sendSuccessResponse(res, "Product updated successfully", updatedProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid ProductId");
    }

    const product = await Product.findById(id);
    if (!product) return sendNotFoundResponse(res, "Product not found");

    if (userRole === 'seller' && product.sellerId.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only delete your own products");
    }

    if (userRole !== 'admin' && userRole !== 'seller') {
      return sendBadRequestResponse(res, "Unauthorized access");
    }

    if (product.productBanner && product.productBanner.length > 0) {
      for (const imgUrl of product.productBanner) {
        try {
          const key = imgUrl.split(".amazonaws.com/")[1];
          await deleteFromS3(key);
        } catch (error) {
          console.log("Error deleting image from S3:", error.message);
        }
      }
    }

    await Product.findByIdAndDelete(id);

    await sellerModel.findByIdAndUpdate(
      product.sellerId,
      { $pull: { products: product._id } },
      { new: true }
    );

    const message = userRole === 'admin'
      ? "Product deleted successfully by admin"
      : "Product deleted successfully";

    return sendSuccessResponse(res, message, product);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return sendBadRequestResponse(res, "Valid categoryId is required");
    }

    // Step 1: Find all child categories recursively (including nested ones)
    const allChildIds = await getAllChildCategoryIds(categoryId);

    // Step 2: Create a list of ObjectIds to search
    // We explicitly map everything to mongoose.Types.ObjectId to ensure the $in query works perfectly
    const categoryIds = [
      new mongoose.Types.ObjectId(categoryId),
      ...allChildIds.map(id => new mongoose.Types.ObjectId(id))
    ];



    // Step 3: Find products that match ANY of these categories
    const products = await Product.find({ categories: { $in: categoryIds } })
      .populate("sellerId")
      .populate("brand")
      .populate("categories");

    if (products.length === 0) {
      return sendNotFoundResponse(res, "No products found for this category");
    }

    return sendSuccessResponse(res, "Products fetched successfully", products || []);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductFilters = async (req, res) => {
  try {
    const categories = await categoryModel.find({}, { name: 1 });
    const brands = await brandModel.find({}, { brandName: 1 });

    const priceAgg = await productVarientModel.aggregate([
      {
        $project: {
          allPrices: {
            $concatArrays: [
              [
                {
                  $ifNull: [
                    "$color.discountedPrice",
                    "$color.price"
                  ]
                }
              ],
              {
                $map: {
                  input: "$color.sizes",
                  as: "s",
                  in: {
                    $ifNull: ["$$s.discountedPrice", "$$s.price"]
                  }
                }
              }
            ]
          }
        }
      },
      { $unwind: "$allPrices" },
      {
        $group: {
          _id: null,
          minPrice: { $min: "$allPrices" },
          maxPrice: { $max: "$allPrices" }
        }
      }
    ]);

    const colorAgg = await productVarientModel.aggregate([
      { $match: { "color.colorName": { $ne: null } } },
      { $group: { _id: "$color.colorName" } }
    ]);

    const sizeAgg = await productVarientModel.aggregate([
      { $unwind: "$color.sizes" },
      { $group: { _id: "$color.sizes.sizeValue" } }
    ]);

    const ratingAgg = await reviewModel.aggregate([
      {
        $group: {
          _id: "$productId",
          avgRating: { $avg: "$overallRating" }
        }
      },
      {
        $project: {
          roundedRating: {
            $ceil: "$avgRating"
          }
        }
      },
      {
        $group: {
          _id: "$roundedRating",
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    return sendSuccessResponse(res, "Product filters fetched successfully", {
      categories,
      brands,
      priceRange: priceAgg[0] || { minPrice: 0, maxPrice: 0 },
      colors: colorAgg.map(c => c._id),
      sizes: sizeAgg.map(s => s._id),
      ratings: ratingAgg.map(r => ({
        rating: r._id,
        count: r.count
      }))
    });

  } catch (error) {

    return sendErrorResponse(res, 500, "Error while getProductFilters", error);
  }
};

export const getProductsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return sendBadRequestResponse(res, "Invalid brand ID");
    }

    const brand = await brandModel.findById(brandId).lean();
    if (!brand) return sendNotFoundResponse(res, "Brand not found");

    const products = await Product.find({ brand: brandId, isActive: true })
      .populate("sellerId", "firstName lastName email shopName")
      .populate("brand", "brandName brandImage")
      .populate("categories", "name image")
      .lean();

    return sendSuccessResponse(res, `Products for brand ${brand.brandName} fetched successfully`, {
      brandId: brand._id,
      brandName: brand.brandName,
      brandImage: brand.brandImage,
      products: products || []
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const searchProducts = async (req, res) => {
  try {
    const { q, categoryId } = req.query

    let categoryIds = []

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      const childCategories = await categoryModel.find(
        { parentCategory: categoryId },
        { _id: 1 }
      )

      if (childCategories.length > 0) {
        categoryIds = childCategories.map(c => c._id)
      } else {
        categoryIds = [categoryId]
      }
    }

    const matchQuery = {
      isActive: true
    }

    if (q && q.trim()) {
      matchQuery.$or = [
        { title: { $regex: q.trim(), $options: "i" } },
        { description: { $regex: q.trim(), $options: "i" } }
      ]
    }

    if (categoryIds.length > 0) {
      matchQuery.categories = { $in: categoryIds }
    }

    const products = await productModel.find(matchQuery)
      .populate({
        path: "variantId",
        model: "productVariant",
        options: { limit: 1 }
      })
      .sort({ createdAt: -1 })
      .lean();

    const formattedProducts = products.map(product => {
      let variantIdArray = [];

      if (product.variantId) {
        if (Array.isArray(product.variantId)) {
          variantIdArray = product.variantId.length > 0 ? [product.variantId[0]] : [];
        } else if (typeof product.variantId === 'object' && product.variantId._id) {
          variantIdArray = [product.variantId];
        }
      }

      return {
        ...product,
        variantId: variantIdArray
      }
    })

    return sendSuccessResponse(res, "Products fetched successfully", formattedProducts)

  } catch (error) {

    return sendErrorResponse(res, 500, "error while searchProducts", error)
  }
}


export const getProductVraintByproductId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id && !mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Somthing went wrong in paramns id")

    const vraints = await productVarientModel.find({
      productId: id
    })

    return sendSuccessResponse(res, "getProductVraintByproductId featched successfully", vraints);

  } catch (error) {

    return sendErrorResponse(res, 500, "Errro while getProductVraintByproductId", error);
  }
}

export const getVraintSizesByColorName = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.query;

    if (!id) {
      return sendBadRequestResponse(res, "Invalid variant id");
    }

    if (!name) {
      return sendBadRequestResponse(res, "Color name is required");
    }

    const variant = await productVarientModel.findById(id).select("color");

    if (!variant) {
      return sendBadRequestResponse(res, "Variant not found");
    }

    const color = variant.color;

    if (
      color &&
      color.colorName.toLowerCase().trim() === name.toLowerCase().trim()
    ) {
      const sizes = color.sizes || [];

      return sendSuccessResponse(
        res,
        `${name} sizes fetched successfully`,
        { sizes }
      );
    }

    return sendSuccessResponse(
      res,
      "Color not matched. Available color:",
      { availableColor: color.colorName }
    );

  } catch (error) {

    return sendErrorResponse(
      res,
      500,
      "Error while getVraintSizesByColorName",
      error
    );
  }
};
