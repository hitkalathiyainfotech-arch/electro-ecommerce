import axios from 'axios';


const options = {
  method: 'GET',
  url: 'https://cricbuzz-cricket.p.rapidapi.com/mcenter/v1/40381/hscard',
  headers: {
    'x-rapidapi-key': 'f3db12d99dmsh0a5a293a042f20cp10c76djsnd707e270b5f0',
    'x-rapidapi-host': 'cricbuzz-cricket.p.rapidapi.com'
  }
};
import fs from 'fs';

async function fetchData() {
  try {
    const response = await axios.request(options);
    console.log(response.data);
  } catch (error) {
    console.error(error);
  }
}

fetchData();