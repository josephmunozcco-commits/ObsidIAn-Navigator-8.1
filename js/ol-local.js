import "ol/ol.css";
import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import Overlay from "ol/Overlay.js";
import TileLayer from "ol/layer/Tile.js";
import ImageLayer from "ol/layer/Image.js";
import VectorLayer from "ol/layer/Vector.js";
import Graticule from "ol/layer/Graticule.js";
import XYZ from "ol/source/XYZ.js";
import ImageCanvas from "ol/source/ImageCanvas.js";
import VectorSource from "ol/source/Vector.js";
import TileGrid from "ol/tilegrid/TileGrid.js";
import Translate from "ol/interaction/Translate.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import Style from "ol/style/Style.js";
import Icon from "ol/style/Icon.js";
import Circle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Text from "ol/style/Text.js";

export const ol = {
  Map,
  View,
  Feature,
  Overlay,
  layer: {
    Tile: TileLayer,
    Image: ImageLayer,
    Vector: VectorLayer,
    Graticule,
  },
  source: {
    XYZ,
    ImageCanvas,
    Vector: VectorSource,
  },
  tilegrid: {
    TileGrid,
  },
  interaction: {
    Translate,
  },
  geom: {
    Point,
    LineString,
  },
  style: {
    Style,
    Icon,
    Circle,
    Fill,
    Stroke,
    Text,
  },
};

export default ol;
