const fs = require('fs');
fetch('https://api.jsonbin.io/v3/b/69b42732b7ec241ddc66a506/latest', {headers:{'X-Master-Key':'$2a$10$oYANSzZQ3hm27sTDDedds.DbkKQZObqPZieEJ/bg8i/hnh/2SMs8u'}})
.then(r=>r.json())
.then(j=>{ 
  fs.writeFileSync('answers_dump.json', JSON.stringify(j.record._answers, null, 2));
  console.log("Done fetching answers");
});
