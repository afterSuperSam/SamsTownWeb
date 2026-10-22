# Yingwu Town Platform

The Yingwu Town platform presents the community, its shared resources, members, history, and collaboratively managed town maps.

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
