-- Extend the existing editor and calculation without editing any Steam file.
-- Match both Windows and POSIX paths; the old POC only accepted forward slashes.
-- The editor marker has no dependency on frontend load order.
return {
    {
        file = [[(?:^|[\\/])(?:sp|chunk~[0-9a-f]+)\.js(?:\?.*)?$]],
        find = [[className:\w+\(\)\.CollectionEditor,style:\{height:\w+\?"auto":0,opacity:\w+\?1:0,pointerEvents:\w+\?"initial":"none"\},children:\(0,\w+\.jsx\)\(\w+\.\w+,\{appFilter:\w+\.internalAppFilter,bUseWideFormat:[^{}]{1,180},bHideSaveButton:!0,fnOnChange:\(\)=>\w+\.Save\(\)\}\)]],
        transforms = {
            {
                match = [[(className:\w+\(\)\.CollectionEditor,style:\{height:(\w+)\?"auto":0,opacity:\w+\?1:0,pointerEvents:\w+\?"initial":"none"\},children:)(\(0,(\w+)\.jsx\)\(\w+\.\w+,\{appFilter:(\w+)\.internalAppFilter,bUseWideFormat:[^{}]{1,180},bHideSaveButton:!0,fnOnChange:\(\)=>\w+\.Save\(\)\}\))]],
                replace = [=["data-sac-collection-id":\5.bIsDynamic&&\5.bIsEditable?\5.id:void 0,"data-sac-editor-open":\5.bIsDynamic&&\5.bIsEditable&&\2?"true":void 0,\1\3]=],
            },
        },
    },
    {
        file = [[(?:^|[\\/])(?:sp|chunk~[0-9a-f]+)\.js(?:\?.*)?$]],
        find = [[UpdateApps\(\w+,\w+\)\{const \w+=new Set\(this\.m_setApps\);if\(this\.m_filter&&!this\.m_filter\.bIsEmpty\)\{for\(let \w+ of \w+\.filter\(\w+=>\w+\.visible_in_game_list\)\)this\.m_filter\.Matches\(\w+\)]],
        transforms = {
            {
                match = [[UpdateApps\(]],
                replace = [[__sacNativeBridgeV1(){return 1}UpdateApps(]],
            },
            {
                match = [[if\(this\.m_filter&&!this\.m_filter\.bIsEmpty\)]],
                replace = [[if(this.m_filter&&((window.PLUGIN_LIST?.['com.steamadvancedcollections.plugin']?.integration?.hasRules?.(this)??false)||!this.m_filter.bIsEmpty))]],
            },
            {
                match = [[this\.m_filter\.Matches\((\w+)\)]],
                replace = [[(window.PLUGIN_LIST?.['com.steamadvancedcollections.plugin']?.integration?.matches?.(this,\1)??this.m_filter.Matches(\1))]],
            },
        },
    },
}
