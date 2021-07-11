import subprocess
import sys

reference_file = sys.argv[1]
deg_file = sys.argv[2]

cmd = "./visqol.exe --verbose --reference_file=" + reference_file + " --degraded_file=" + deg_file + " --similarity_to_quality_model=libsvm_nu_svr_model.txt"
subprocess.run(cmd)
