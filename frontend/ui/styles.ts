export const css = `
.sac-advanced-filters{box-sizing:border-box;width:100%;min-width:0;padding:18px;margin:14px 0;background:linear-gradient(135deg,#223347,#1b2838);border:1px solid #3c5066;border-radius:5px;color:#d6dce3;font:14px/1.5 Arial,sans-serif;text-align:left;color-scheme:dark}
.sac-advanced-filters *{box-sizing:border-box}
.sac-advanced-filters h3{font-size:18px;margin:0;font-weight:500;color:#fff}
.sac-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.sac-advanced-filters p{margin:8px 0}.sac-advanced-filters label{display:inline-flex;align-items:center;gap:7px}
.sac-advanced-filters input[type=checkbox]{accent-color:#66c0f4;width:15px;height:15px;margin:0;flex-shrink:0}
.sac-enable{font-size:12px;color:#bbcbd8;margin-left:auto}.sac-intro{max-width:80ch}
.sac-live-preview{font-size:11px;color:#9bcca9;display:inline-flex;align-items:center;gap:5px}
.sac-live-preview:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}
.sac-advanced-filters button,.sac-advanced-filters select,.sac-advanced-filters input[type=number],.sac-advanced-filters input[type=text]{font:inherit;background:#293f52;color:#e5edf4;border:1px solid #486079;border-radius:3px;min-height:32px;padding:5px 9px;max-width:100%}
.sac-creator{width:330px}
.sac-advanced-filters select{width:auto;min-width:0;text-overflow:ellipsis;cursor:pointer}
.sac-advanced-filters button{cursor:pointer;flex:none;white-space:nowrap}
.sac-advanced-filters button:hover:not(:disabled){background:#39566e;border-color:#66a2c6}
.sac-advanced-filters :focus-visible{outline:2px solid #66c0f4;outline-offset:2px}
.sac-advanced-filters :disabled{opacity:.5;cursor:default}
.sac-rule-fieldset{border:0;margin:14px 0;padding:0;min-width:0;overflow-x:auto}
.sac-group{border:1px solid #3e5369;border-radius:4px;background:rgba(10,19,29,.18);min-width:0;padding:10px;margin:8px 0}
.sac-group-heading,.sac-condition,.sac-group-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.sac-group-heading{gap:6px}.sac-advanced-filters .sac-group-match{max-width:290px;font-size:13px;background:#23384b}
.sac-advanced-filters .sac-disclosure{padding:0;width:28px;min-height:28px;border-color:transparent;background:transparent;color:#a9c3d9}
.sac-invert{margin-left:auto;color:#b1bfcd;font-size:12px}.sac-inverted{border-color:#80674d}.sac-inverted>.sac-group-heading .sac-invert{color:#e0be96}
.sac-advanced-filters .sac-remove{margin-left:auto;font-size:20px;line-height:1;padding:3px;width:28px;min-height:28px;color:#a8b8c7;background:transparent;border-color:transparent}
.sac-advanced-filters .sac-remove:hover:not(:disabled){color:#ffc4b8;background:#613b3b;border-color:transparent}
.sac-children{margin:10px 0 8px 8px;padding-left:10px;border-left:1px solid #425970;min-width:0}
.sac-condition{padding:6px 0}.sac-field{max-width:190px}.sac-operator{max-width:100px}.sac-value{max-width:330px}
.sac-number{width:108px;min-width:60px}.sac-measure-operator{max-width:150px}.sac-measure-hint{flex-basis:100%;font-size:11px;color:#9eafbe;line-height:1.5}
.sac-group-actions{padding-top:5px}.sac-advanced-filters .sac-group-actions button{background:transparent;border-color:transparent;color:#82b9dc;font-size:12px;padding:4px 7px}
.sac-group-summary,.sac-hint{font-size:12px;color:#9eafbe;line-height:1.5}.sac-group-summary{padding-left:34px}.sac-empty{padding:4px}
.sac-warning{color:#ebc38c;font-size:12px}
.sac-footer{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #3b5065}
.sac-advanced-filters .sac-primary{background:linear-gradient(90deg,#347fa7,#24608d);border-color:#3a82ac;min-width:76px;color:white}
.sac-footer [role=status]{margin-left:auto}
@media(max-width:700px){.sac-advanced-filters{padding:12px}.sac-group{padding:8px}.sac-children{margin-left:3px;padding-left:6px}.sac-invert{margin-left:0}.sac-condition{gap:6px}.sac-value{max-width:100%}}
`;
