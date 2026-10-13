# Yingwu Town Platform

The Yingwu Town platform presents the community, members, history, forum, and collaboratively managed town maps.

## Map Language

**Town Map**:
An uploaded overhead image representing one independently managed town area.
_Avoid_: Layer, canvas, map file

**Map Pixel**:
One pixel in a Town Map, representing one Minecraft block.
_Avoid_: Tile, chunk

**Chunk**:
A claimable 16 by 16 Map Pixel square aligned from the Town Map's top-left corner.
_Avoid_: Pixel, cell, plot

**Map Project**:
A named construction or technical undertaking with an owner, description, status, and chosen colour.
_Avoid_: Claim, marker

**Claim**:
The exclusive reservation of one or more Chunks for a single Map Project. A Member owns and manages their own Claims; an Admin may manage any Claim.
_Avoid_: Selection, territory

**Claim Region**:
A maximal group of a Claim's Chunks connected through shared top, bottom, left, or right edges. One Claim may contain multiple Claim Regions.
_Avoid_: Merged claim, cluster

**Occupancy Overview**:
A bounded, coarse aggregation of reserved Chunks for a zoomed-out Town Map. It shows distribution, not selectable Claim details.
_Avoid_: Empty territory, exact boundary

**Viewport Cells**:
The exact claimed Chunks loaded for the current visible image bounds and a limited buffer. This is a partial view, not a complete Claim.
_Avoid_: Complete selection, all chunks

**Claim Summary**:
An independently paginated full-map record with complete Chunk count and bounds for search and navigation. Editing first loads the complete Claim.
_Avoid_: Visible count, viewport project

**Marker**:
A public named point placed at a Map Pixel by an Admin and classified as a building, machine, or other place.
_Avoid_: Claim, project

**Project Status**:
The lifecycle state of a Map Project: Planned, In Progress, Completed, Paused, or Abandoned. Every status continues to reserve its claimed Chunks until the Claim is explicitly changed or deleted.
_Avoid_: Visibility, progress percentage

## Access Language

**Viewer**:
An authenticated account that may view Town Maps, Claims, and Markers.

**Member**:
An authenticated account that may also create and manage Claims owned by that account.

**Admin**:
An authenticated account that may manage Town Maps, every Claim, and every Marker.

**Owner**:
An account with all Admin map rights plus platform account-management authority.
