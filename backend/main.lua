local logger = require("logger")
local millennium = require("millennium")
local frontend_ready = false

return {
    on_load = function()
        logger:info("[SAC] backend ready; Millennium " .. millennium.version())
        millennium.ready()
    end,
    on_unload = function()
        if frontend_ready then pcall(millennium.call_frontend_method, "disposePlugin", {}) end
        logger:info("[SAC] backend unloaded")
    end,
    on_frontend_loaded = function()
        frontend_ready = true
        logger:info("[SAC] frontend attached")
    end,
    patches = require("diagnostic_patch"),
}
