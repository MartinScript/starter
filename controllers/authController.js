const { promisify } = require('util');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/userModels');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');

const signToken = (id) => {
    jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
}

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id)

    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
            user
        }
    });
};

exports.signup = catchAsync(async (req, res, next) => {
    const newUser = await User.create({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        passwordConfirm: req.body.passwordConfirm
    });

    createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return next(new AppError('Please provide email and password', 400));
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
        return next(new AppError('Incorrect email or password', 401));
    };

    createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
    //1, Get token and check presence
    let token;
    if (req.headers.authorization && req.headers.authorization.StartWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        return next(new AppError('You must be logged in, Please log in to get access', 401));
    }
    //Verifytoken
    const decodedToken = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    //check if user exists
    const currentUser = await User.findById(decodedToken.id);
    if (!currentUser) {
        return next(new AppError('The user attached to this token does not exist', 401));
    }
    //Check if user changed password after token was issued
    if (currentUser.changedPasswordAt(decoded.iat)) {
        return next(new AppError('User recently changed password, log in again', 401));
    }
    req.user = currentUser;
    next();
});

exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(new AppError('You do not have permission to perform this action', 403));
        }
        next();
    };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
    //get user based on posted email
    const user = await User.findByOne({ email: req.body.email });
    if (!user) {
        return next(new AppError('There is no user with this email address', 404));
    }
    //generate the random reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    //send to user's email
    const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;
    const message = `Forgot your password? Submit a patch request with your password and passwordConfirm to: ${resetURL}.\nIf you didn't forget, please ignore this email`;

    try {
        await sendEmail({
            email: user.email,
            subject: 'Your password reset token(valid for 10min',
            message
        })
        res.status(200).json({
            status: 'success',
            message: 'Token sent to email'
        })
    } catch (err) {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });

        return next(new AppErrror('There was an error sending the Email, please try again later', 500));
    }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
    //get user based on token
    const hashedtoken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
        passwordResetToken: hashedtoken,
        passwordResetExpires: { $gt: Date.now() }
    });
    //if token has not expired and user exists
    if (!user) {
        return next(new AppError('Invalid token or token has expired', 400));
    }
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    //log the user in, send JWT
    createSendToken(user, 201, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
    //get user from collection
    const user = await User.findById(req.user.id).select('+password');

    //check if posted current password is correct
    if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
        return next(new AppError('Your current password is incorrect', 401))
    }
    //if password is correct update password
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    await user.save();
    //log the user in, send JWT
    createSendToken(user, 200, res);
});
