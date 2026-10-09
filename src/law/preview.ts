export interface OfficeLawPreviewPosition{
	top:number;
	left:number;
	width:number;
	maxHeight:number;
}

export class OfficeLawPreview{
	public static position(
		anchor:Pick<DOMRect,"top"|"bottom"|"left">,
		viewport:{width:number; height:number},
		popupHeight?:number
	):OfficeLawPreviewPosition{
		const width=Math.min(440,viewport.width-24);
		const below=viewport.height-anchor.bottom-20;
		const above=anchor.top-20;
		const placeBelow=below>=180 || below>=above;
		const maxHeight=Math.max(80,Math.min(360,placeBelow ? below : above));
		const height=Math.min(popupHeight ?? maxHeight,maxHeight);
		return{
			top:placeBelow ? anchor.bottom+8 : Math.max(12,anchor.top-height-8),
			left:Math.max(12,Math.min(anchor.left,viewport.width-width-12)),
			width,maxHeight
		};
	}
}
