local logger = require("logger")
local millennium = require("millennium")
local frontend_ready = false

return {
    on_load = function()
        logger:info("[SAC] backend ready; Millennium " .. millennium.version())
        millennium.ready()
    end,
    on_unload = function()
        local ok, status = pcall(millennium.call_frontend_method, "metadataStatus", {})
        if ok then logger:info("[SAC] metadata.sources " .. tostring(status)) end
        if frontend_ready then pcall(millennium.call_frontend_method, "disposePlugin", {}) end
        logger:info("[SAC] backend unloaded")
    end,
    on_frontend_loaded = function()
        frontend_ready = true
        logger:info("[SAC] frontend attached")
        local ok, status = pcall(millennium.call_frontend_method, "metadataStatus", {})
        if ok then logger:info("[SAC] metadata.sources " .. tostring(status)) end
    end,
    patches = require("diagnostic_patch"),
}
