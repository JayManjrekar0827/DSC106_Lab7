import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'YOUR_ACCESS_TOKEN_HERE';

const INPUT_BLUEBIKES_JSON_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRAFFIC_CSV_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const bikeLanePaint = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

let baseStations = [];
let timeFilter = -1;
let timeSlider;
let selectedTime;
let anyTimeLabel;
let radiusScale;
let circles;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute + 1);
    return beforeMidnight.concat(afterMidnight).flat();
  }

  return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
}

function computeStationTraffic(stations, filter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, filter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, filter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    const dep = departures.get(id) ?? 0;
    const arr = arrivals.get(id) ?? 0;
    return {
      ...station,
      departures: dep,
      arrivals: arr,
      totalTraffic: dep + arr,
    };
  });
}

function departureRatio(station) {
  return station.totalTraffic
    ? station.departures / station.totalTraffic
    : 0.5;
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  const svg = d3.select('#map').select('svg');

  let jsonData;
  try {
    jsonData = await d3.json(INPUT_BLUEBIKES_JSON_URL);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  baseStations = jsonData.data.stations;

  try {
    await d3.csv(TRAFFIC_CSV_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      const startedMinutes = minutesSinceMidnight(trip.started_at);
      const endedMinutes = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[startedMinutes].push(trip);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    });
    console.log('Loaded traffic data into minute buckets');
  } catch (error) {
    console.error('Error loading traffic CSV:', error);
    return;
  }

  let stations = computeStationTraffic(baseStations);

  radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .style('--departure-ratio', (d) => stationFlow(departureRatio(d)))
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  timeSlider = document.getElementById('time-slider');
  selectedTime = document.getElementById('selected-time');
  anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(filter) {
    const filteredStations = computeStationTraffic(baseStations, filter);

    radiusScale.domain([
      0,
      d3.max(filteredStations, (d) => d.totalTraffic) || 0,
    ]);
    filter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles = circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => stationFlow(departureRatio(d)))
      .each(function (d) {
        const circle = d3.select(this);
        circle.select('title').remove();
        circle
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      });

    updatePositions();
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
