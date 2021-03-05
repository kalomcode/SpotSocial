'use strict'

var bcrypt = require('bcrypt-nodejs');
var mongoosePaginate = require('mongoose-pagination');
var fs = require('fs');
var path = require('path');

var User = require('../models/user');
var Follow = require('../models/follow');
var Publication = require('../models/publication');
var jwt = require('../services/jwt');

// Metodos de prueba
function home(req, res) {
    res.status(200).send({
        message: 'Hola mundo desde el servidor de NodeJS'
    });
}

function pruebas(req, res) {
    res.status(200).send({
        message: 'Accion de pruebas en el servidor nodeJS'
    });
}

// Registro
function saveUser(req, res) {
    var params = req.body;
    var user = new User();

    if (params.name && params.surname && params.nick && params.email && params.password) {
        user.name = params.name;
        user.surname = params.surname;
        user.nick = params.nick;
        user.email = params.email;
        user.role = 'ROLE_USER';
        user.image = null;

        // Controlar el registro de usuarios duplicados
        User.find({
            $or: [{
                    email: user.email.toLowerCase()
                },
                {
                    nick: user.nick.toLowerCase()
                }
            ]
        }).exec((err, users) => {
            if (err) return res.status(500).send({
                message: 'Error en la peticion de usuarios'
            });

            if (users && users.length >= 1) {
                return res.status(200).send({
                    message: 'El correo o nombre de usuario que intentas registrar ya existen'
                })
            } else {
                // Cifrado de password y guardado de un nuevo registro de usuario
                bcrypt.hash(params.password, null, null, (err, hash) => {
                    user.password = hash;

                    user.save((err, userStored) => {
                        if (err) return res.status(500).send({
                            message: 'Error al guardar el usuario'
                        });

                        if (userStored) {
                            res.status(200).send({
                                user: userStored
                            });
                        } else {
                            res.status(404).send({
                                message: 'No se ha registrado el usuario'
                            });
                        }
                    })
                });
            }
        });



    } else {
        res.status(200).send({
            message: 'Envia todos los campos necesarios!!'
        })
    }
}

// Login
function loginUser(req, res) {
    var params = req.body;
    console.log(params)

    var email = params.email;
    var password = params.password;

    User.findOne({
        email: email
    }, (err, user) => {
        if (err) return res.status(500).send({
            message: 'Error en la petición'
        });

        if (user) {
            bcrypt.compare(password, user.password, (err, check) => {
                if (check) {
                    // devolver datos de usuario
                    if (params.gettoken) {
                        // generar y devolver token
                        return res.status(200).send({
                            token: jwt.createToken(user)
                        })
                    } else {
                        // devolver usuario en claro
                        user.password = undefined;
                        return res.status(200).send({
                            user
                        })
                    }
                } else {
                    return res.status(404).send({
                        message: 'El usuario no se ha podido identificar'
                    });
                }
            })
        } else {
            return res.status(404).send({
                message: 'El usuario no se ha podido identificar!!'
            });
        }
    })
}

// Conseguir datos de un usuario
function getUser(req, res) {
    var userId = req.params.id;

    User.findById(userId, (err, user) => {
        if (err) return res.status(500).send({
            message: 'Error en la petición'
        });

        if (!user) return res.status(404).send({
            message: 'El usuario no existe'
        });

        followThisUser(req.user.sub, userId).then((value) => {
            return res.status(200).send({
                user: user, 
                following: value.following,
                followed: value.followed
            });
        });

        
    })
}

async function followThisUser(identity_user_id, user_id) {

    try{
        var following = await Follow.findOne({
            'user': identity_user_id,
            'followed': user_id
        })
        var followed = await Follow.findOne({
            'user': user_id,
            'followed': identity_user_id
        })
    }
    catch(err){
        return res.send(err);
    }
    

    return {followed: followed, following: following};
}

// Devolver un listado de usuarios paginado
function getUsers(req, res) {
    var identity_user_id = req.user.sub;

    var page = 1;
    if (req.params.page) {
        page = req.params.page;
    }

    var itemsPerPage = 5;

    User.find().sort('_id').paginate(page, itemsPerPage, (err, users, total) => {
        if (err) return res.status(500).send({
            message: 'Error en la petición'
        });

        if (!users) return res.status(404).send({
            message: 'No hay usuarios disponibles'
        });

        followUserIds(identity_user_id).then((value)=>{
            return res.status(200).send({
                users,
                users_following: value.following,
                users_follow_me: value.followed,
                total,
                pages: Math.ceil(total / itemsPerPage)
            });
        })
        
    });
}

async function followUserIds(user_id){
    var following = [];
    var followings = await Follow.find({'user':user_id}).select({'_id':0,'__v':0,'user':0})
    followings.forEach((follow) => {
        following.push(follow.followed);
    });
    var followed = [];
    var followeds = await Follow.find({'followed':user_id}).select({'_id':0,'__v':0,'followed':0})
    followeds.forEach((follow) => {
        followed.push(follow.user);
    });

    return {
        following: following,
        followed: followed
    };
}

function getCounters(req,res){
    var userId = req.user.sub;
    if(req.params.id){
        userId = req.params.id;
    }
    getCountFollow(userId).then((value)=>{
        return res.status(200).send(value);
    })
}

async function getCountFollow(user_id){
    var following = await Follow.count({'user':user_id})
    var followed = await Follow.count({'followed':user_id})
    var publications = await Publication.count({'user':user_id})

    return {
        following: following,
        followed: followed,
        publications: publications
    }
}


// Edición de datos de usuario
function updateUser(req, res) {
    var userId = req.params.id;
    var update = req.body;

    // borrar propiedad password
    delete update.password;

    if (userId != req.user.sub) {
        return res.status(500).send({
            message: 'No tienes permiso para actualizar los datos del usuario'
        })
    }

    User.findOne({
        $or: [{
                email: update.email.toLowerCase()
            },
            {
                nick: update.nick.toLowerCase()
            }
        ]
    }).exec((err, user)=>{
        if(user && user._id != userId) return res.status(200).send({message: 'Los datos ya estan en uso'})
        
        User.findByIdAndUpdate(userId, update, {
            new: true
        }, (err, userUpdated) => {
            if (err) return res.status(500).send({
                message: 'Error en la petición'
            });
    
            if (!userUpdated) return res.status(404).send({
                message: 'No se ha podido actualizar el usuario'
            });
    
            return res.status(200).send({
                user: userUpdated
            });
        })
    
    });

}

// Subir archivos de imagen/avatar de usuario
function uploadImage(req, res) {
    var userId = req.params.id;
    console.log('holaaa')
    if (req.files) {
        var file_path = req.files.image.path;
        console.log(file_path);

        var file_split = file_path.split('/');
        console.log(file_split);

        var file_name = file_split[2];

        var ext_split = file_name.split('\.');
        var file_ext = ext_split[1];
        console.log(file_split[2], file_ext);

        if (userId != req.user.sub) {
            return removeFilesOfUpload(res, file_path, 'No tienes permiso para actualizar los datos del usuario');
        }

        if (file_ext == 'png' || file_ext == 'jpg' || file_ext == 'jpeg' || file_ext == 'gif') {

            // Actualizar documento de usuario logueado
            User.findByIdAndUpdate(userId, {
                image: file_name
            }, {
                new: true
            }, (err, userUpdated) => {
                if (err) return res.status(500).send({
                    message: 'Error en la petición'
                });

                if (!userUpdated) return res.status(404).send({
                    message: 'No se ha podido actualizar el usuario'
                });

                return res.status(200).send({
                    user: userUpdated
                });
            })

        } else {
            return removeFilesOfUpload(res, file_path, 'Extensión no válida');
        }
    } else {
        return res.status(200).send({
            message: 'No se ha subido imagenes'
        });
    }
}

function removeFilesOfUpload(res, file_path, message) {
    fs.unlink(file_path, err => {
        return res.status(200).send({
            message: message
        })
    })
};

function getImageFile(req, res) {
    var image_file = req.params.imageFile;
    var path_file = './uploads/users/' + image_file;

    fs.exists(path_file, (exists) => {
        if (exists) {
            res.sendFile(path.resolve(path_file));
        } else {
            res.status(200).send({
                message: 'No existe la imagen'
            })
        }
    });

}

module.exports = {
    home,
    pruebas,
    saveUser,
    loginUser,
    getUser,
    getUsers,
    getCounters,
    updateUser,
    uploadImage,
    getImageFile
}